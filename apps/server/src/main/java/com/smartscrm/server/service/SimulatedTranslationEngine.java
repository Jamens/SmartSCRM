package com.smartscrm.server.service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * Deterministic stand-in for a translation channel. Matches seeded phrases (longest
 * first) over the source text and leaves everything else verbatim, which is exactly
 * what the `partial` flag reports. It never sleeps and never hits the network.
 */
@Component
public class SimulatedTranslationEngine {

    public record EngineResult(String translation, boolean partial, String fromLang) {
    }

    private record Pattern(String source, String target) {
    }

    private final PhraseDict dict;

    public SimulatedTranslationEngine(PhraseDict dict) {
        this.dict = dict;
    }

    public static String normalize(String text) {
        if (text == null) {
            return "";
        }
        String[] lines = text.trim().replace('\t', ' ').split("\n", -1);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < lines.length; i++) {
            if (i > 0) {
                sb.append('\n');
            }
            sb.append(lines[i].replaceAll(" {2,}", " ").trim());
        }
        return sb.toString();
    }

    public EngineResult translate(String rawText, String fromLang, String toLang, String channel) {
        String text = normalize(rawText);
        boolean toKnown = dict.supports(toLang);
        String source = (fromLang == null || fromLang.isBlank() || "auto".equals(fromLang))
            ? detect(text)
            : fromLang;

        if (source == null || !toKnown || !dict.supports(source)) {
            // R8: never blank, never an error — hand the caller its own text and say so.
            return new EngineResult(text, true, source == null ? "" : source);
        }
        if (source.equals(toLang)) {
            return new EngineResult(text, false, source);
        }

        MatchResult matched = match(text, source, toLang);
        return new EngineResult(style(channel, toLang, matched.text()), matched.partial() || !toKnown, source);
    }

    // ============ internals ============

    private record MatchResult(String text, boolean partial, int coveredChars) {
    }

    private String detect(String text) {
        String best = null;
        int bestCovered = 0;
        for (String lang : PhraseDict.SUPPORTED) {
            if (!dict.supports(lang)) {
                continue;
            }
            int covered = match(text, lang, lang).coveredChars();
            // Strict '>' plus SUPPORTED's order makes the first language win a tie.
            if (covered > bestCovered) {
                bestCovered = covered;
                best = lang;
            }
        }
        return best;
    }

    private MatchResult match(String text, String sourceLang, String targetLang) {
        List<Pattern> patterns = patterns(sourceLang, targetLang);
        String out = text;
        int covered = 0;
        for (Pattern p : patterns) {
            if (!p.source().isEmpty() && out.contains(p.source())) {
                covered += p.source().length() * countOccurrences(out, p.source());
                out = out.replace(p.source(), p.target());
            }
        }
        boolean partial = covered < visibleChars(text);
        return new MatchResult(out, partial, covered);
    }

    private List<Pattern> patterns(String sourceLang, String targetLang) {
        Map<String, String> source = dict.byLang(sourceLang);
        Map<String, String> target = dict.byLang(targetLang);
        List<Pattern> list = new ArrayList<>();
        for (Map.Entry<String, String> entry : source.entrySet()) {
            String replacement = target.get(entry.getKey());
            if (replacement != null && !entry.getValue().isBlank()) {
                list.add(new Pattern(entry.getValue(), replacement));
            }
        }
        list.sort(Comparator.comparingInt((Pattern p) -> p.source().length()).reversed());
        return list;
    }

    private String style(String channel, String toLang, String text) {
        if ("2".equals(channel)) {
            return text.replaceAll("\\s+", " ").trim();
        }
        if ("3".equals(channel) || "4".equals(channel)) {
            if (text.isEmpty()) {
                return text;
            }
            if ("en".equals(toLang)) {
                String capped = Character.toUpperCase(text.charAt(0)) + text.substring(1);
                return capped.endsWith(".") ? capped : capped + ".";
            }
            if ("zh-CN".equals(toLang)) {
                return text.endsWith("。") ? text : text + "。";
            }
        }
        return text;
    }

    private int countOccurrences(String haystack, String needle) {
        int count = 0;
        int idx = haystack.indexOf(needle);
        while (idx >= 0) {
            count++;
            idx = haystack.indexOf(needle, idx + needle.length());
        }
        return count;
    }

    private int visibleChars(String text) {
        return (int) text.chars().filter(c -> !Character.isWhitespace(c)).count();
    }
}

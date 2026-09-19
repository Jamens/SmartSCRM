package com.smartscrm.server.service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/**
 * Deterministic stand-in for a translation channel. Matches seeded phrases (longest
 * first) over the source text and leaves everything else verbatim, which is exactly
 * what the `partial` flag reports. It never sleeps and never hits the network.
 *
 * <p>Phrase lookup ignores letter case: a customer typing "hello" means the dictionary's
 * "Hello". Chinese and other case-less scripts are unaffected by the flag.
 */
@Component
public class SimulatedTranslationEngine {

    public record EngineResult(String translation, boolean partial, String fromLang) {
    }

    private record Phrase(String source, String target, Pattern regex) {
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
        List<Phrase> phrases = phrases(sourceLang, targetLang);
        String out = text;
        int covered = 0;
        for (Phrase p : phrases) {
            Matcher m = p.regex().matcher(out);
            int hits = 0;
            while (m.find()) {
                hits++;
            }
            if (hits == 0) {
                continue;
            }
            // Compare visible chars on both sides: phrase sources carry spaces that
            // visibleChars() strips from the denominator, so raw lengths would
            // over-count coverage and mask unmatched punctuation.
            covered += visibleChars(p.source()) * hits;
            out = m.replaceAll(Matcher.quoteReplacement(p.target()));
        }
        boolean partial = covered < visibleChars(text);
        return new MatchResult(out, partial, covered);
    }

    private List<Phrase> phrases(String sourceLang, String targetLang) {
        Map<String, String> source = dict.byLang(sourceLang);
        Map<String, String> target = dict.byLang(targetLang);
        List<Phrase> list = new ArrayList<>();
        for (Map.Entry<String, String> entry : source.entrySet()) {
            String replacement = target.get(entry.getKey());
            if (replacement != null && !entry.getValue().isBlank()) {
                list.add(new Phrase(entry.getValue(), replacement, caseInsensitive(entry.getValue())));
            }
        }
        list.sort(Comparator.comparingInt((Phrase p) -> p.source().length()).reversed());
        return list;
    }

    /** Phrases are matched as literals; only the case-insensitivity is added. */
    private Pattern caseInsensitive(String phrase) {
        return Pattern.compile(Pattern.quote(phrase), Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    }

    /**
     * Channel styles exist to be *observable*, not to fake quality differences: each line has
     * one deterministic tell (collapsed whitespace, a closed sentence, quotes around the answer).
     * Unknown target languages fall through untouched — styling never rewrites what it doesn't know.
     */
    private String style(String channel, String toLang, String text) {
        if ("2".equals(channel)) {
            return collapse(text);
        }
        if ("3".equals(channel) || "4".equals(channel)) {
            return closeSentence(text, toLang);
        }
        if ("5".equals(channel)) {
            return text;
        }
        if ("6".equals(channel)) {
            return closeSentence(collapse(text), toLang);
        }
        if ("7".equals(channel)) {
            return quote(text, toLang);
        }
        return text;
    }

    private String collapse(String text) {
        return text.replaceAll("\\s+", " ").trim();
    }

    /** English gets a capitalised, full-stopped sentence; Chinese a 。; anything else is left alone. */
    private String closeSentence(String text, String toLang) {
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
        return text;
    }

    /** Quotation marks follow the target language: ASCII for English, 「」 for Chinese. */
    private String quote(String text, String toLang) {
        if (text.isEmpty()) {
            return text;
        }
        if ("en".equals(toLang)) {
            return "\"" + text + "\"";
        }
        if ("zh-CN".equals(toLang)) {
            return "「" + text + "」";
        }
        return text;
    }

    private int visibleChars(String text) {
        return (int) text.chars().filter(c -> !Character.isWhitespace(c)).count();
    }
}

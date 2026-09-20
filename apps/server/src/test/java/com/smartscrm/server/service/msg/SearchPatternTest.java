package com.smartscrm.server.service.msg;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import org.junit.jupiter.api.Test;

class SearchPatternTest {

    @Test
    void wrapsAndEscapesWildcards() {
        assertEquals("%100\\%\\_off%", SearchPattern.like("100%_off"));
        assertEquals("%\\\\backslash%", SearchPattern.like("\\backslash"));
    }

    @Test
    void rejectsBlankAndPureWildcardQueries() {
        assertNull(SearchPattern.like(null));
        assertNull(SearchPattern.like("   "));
        // 全角空格：trim() 认它是有效内容，会让一次隐形空格变成 %…% 的全表 LIKE
        assertNull(SearchPattern.like("\u3000"));
        assertNull(SearchPattern.like("\u3000\u3000"));
        assertNull(SearchPattern.like("%"));
        assertNull(SearchPattern.like("_"));
        assertNull(SearchPattern.like("%_%"));
    }
}

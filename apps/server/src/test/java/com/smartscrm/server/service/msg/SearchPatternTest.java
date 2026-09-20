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
        assertNull(SearchPattern.like("%"));
        assertNull(SearchPattern.like("_"));
        assertNull(SearchPattern.like("%_%"));
    }
}

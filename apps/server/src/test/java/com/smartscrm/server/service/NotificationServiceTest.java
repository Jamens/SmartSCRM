package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.Notification;
import com.smartscrm.server.entity.NotificationRead;
import com.smartscrm.server.mapper.NotificationMapper;
import com.smartscrm.server.mapper.NotificationReadMapper;
import java.util.List;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class NotificationServiceTest {

    private static final Long TENANT = 1L;
    private static final Long ME = 100L;
    private static final Long OTHER = 200L;

    private NotificationMapper mapper;
    private NotificationReadMapper readMapper;
    private NotificationService service;

    @BeforeEach
    void setUp() {
        // Pure unit test, no Spring context: register TableInfo for both entities so
        // LambdaQueryWrapper can resolve column names.
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new Configuration(), ""), Notification.class);
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new Configuration(), ""), NotificationRead.class);
        mapper = mock(NotificationMapper.class);
        readMapper = mock(NotificationReadMapper.class);
        service = new NotificationService(mapper, readMapper);
    }

    private static Notification notification(Long id, Long userId) {
        Notification n = new Notification();
        n.setId(id);
        n.setTenantId(TENANT);
        n.setUserId(userId);
        n.setType("system");
        n.setTitle("t" + id);
        return n;
    }

    // ============ publish ============

    @Test
    void publish_defaultsTypeToSystem_andBroadcastWhenUserNull() {
        service.publish(TENANT, null, "标题", "内容", "/messages", null);
        ArgumentCaptor<Notification> cap = ArgumentCaptor.forClass(Notification.class);
        verify(mapper).insert(cap.capture());
        Notification saved = cap.getValue();
        assertEquals("system", saved.getType());
        assertNull(saved.getUserId()); // broadcast
        assertEquals("/messages", saved.getLink());
    }

    @Test
    void publish_rejectsBlankTitle() {
        assertThrows(BizException.class, () -> service.publish(TENANT, "system", "  ", null, null, ME));
        verify(mapper, never()).insert(any(Notification.class));
    }

    // ============ markRead ============

    @Test
    void markRead_insertsReadRowOnce() {
        when(mapper.selectById(5L)).thenReturn(notification(5L, ME));
        when(readMapper.selectCount(any(LambdaQueryWrapper.class))).thenReturn(0L);
        service.markRead(TENANT, ME, 5L);
        verify(readMapper, times(1)).insert(any(NotificationRead.class));
    }

    @Test
    void markRead_isIdempotent_secondCallDoesNotInsert() {
        when(mapper.selectById(5L)).thenReturn(notification(5L, ME));
        when(readMapper.selectCount(any(LambdaQueryWrapper.class))).thenReturn(1L); // already read
        service.markRead(TENANT, ME, 5L);
        verify(readMapper, never()).insert(any(NotificationRead.class));
    }

    @Test
    void markRead_broadcastNotificationIsVisible() {
        when(mapper.selectById(6L)).thenReturn(notification(6L, null)); // userId null = broadcast
        when(readMapper.selectCount(any(LambdaQueryWrapper.class))).thenReturn(0L);
        service.markRead(TENANT, ME, 6L);
        verify(readMapper, times(1)).insert(any(NotificationRead.class));
    }

    @Test
    void markRead_otherUsersTargetedNotificationIsNotFound() {
        when(mapper.selectById(7L)).thenReturn(notification(7L, OTHER)); // someone else's DM
        assertThrows(BizException.class, () -> service.markRead(TENANT, ME, 7L));
        verify(readMapper, never()).insert(any(NotificationRead.class));
    }

    @Test
    void markRead_otherTenantIsNotFound() {
        Notification n = notification(8L, ME);
        n.setTenantId(999L);
        when(mapper.selectById(8L)).thenReturn(n);
        assertThrows(BizException.class, () -> service.markRead(TENANT, ME, 8L));
    }

    // ============ markAllRead ============

    @Test
    void markAllRead_insertsForEachVisibleUnread() {
        when(mapper.selectVisibleUnreadIds(TENANT, ME)).thenReturn(List.of(1L, 2L, 3L));
        int n = service.markAllRead(TENANT, ME);
        assertEquals(3, n);
        verify(readMapper, times(3)).insert(any(NotificationRead.class));
    }

    @Test
    void markAllRead_noneUnread_insertsNothing() {
        when(mapper.selectVisibleUnreadIds(TENANT, ME)).thenReturn(List.of());
        assertEquals(0, service.markAllRead(TENANT, ME));
        verify(readMapper, never()).insert(any(NotificationRead.class));
    }

    // ============ unreadCount ============

    @Test
    void unreadCount_delegatesToMapper() {
        when(mapper.countUnread(TENANT, ME)).thenReturn(4L);
        assertEquals(4L, service.unreadCount(TENANT, ME));
    }

    // ============ page ============

    @Test
    @SuppressWarnings("unchecked")
    void page_marksReadFlagFromReadRows() {
        Notification a = notification(1L, ME);   // read
        Notification b = notification(2L, null); // unread (broadcast, no read row)
        Page<Notification> page = new Page<>(1, 20);
        page.setRecords(List.of(a, b));
        page.setTotal(2);
        when(mapper.selectPage(any(Page.class), any(LambdaQueryWrapper.class))).thenReturn(page);

        NotificationRead readRow = new NotificationRead();
        readRow.setNotificationId(1L);
        when(readMapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(readRow));

        Page<Notification> result = service.page(TENANT, ME, 1, 20, false);
        assertEquals(2, result.getRecords().size());
        assertTrue(result.getRecords().get(0).getRead());  // id=1 read
        assertFalse(result.getRecords().get(1).getRead()); // id=2 unread
    }
}

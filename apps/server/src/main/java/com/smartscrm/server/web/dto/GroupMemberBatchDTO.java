package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotNull;
import java.util.List;

/**
 * 群成员采集的一次上报（spec §6）：群名单 + 一个群的快照 + 一批事件。
 *
 * 三条刻意分成三段而不是合成一个"群对象"数组：它们来自三个不同的时刻与三条不同的链路——
 * 名单来自 {@code getAllGroups}、快照来自 {@code getParticipants}、事件来自订阅与系统消息解析。
 * 合成一个结构会强迫调用方补齐它根本没有的字段，那等于鼓励造数。
 *
 * {@code platform} 不从请求体取：它由账号反查得出（{@code platform_account.platform_type}），
 * 客户端说了不算——否则换一个 platform 值就能把同一批数据写进另一个平台的命名空间。
 */
public class GroupMemberBatchDTO {

    @NotNull
    private Long accountId;

    /** 群名单（可能为空：只有事件要报时不带名单）。 */
    private List<GroupItem> groups;

    /** 一个群的快照；没有就传 null（只报名单或只报事件的轮次）。 */
    private SnapshotItem snapshot;

    private List<EventItem> events;

    public Long getAccountId() {
        return accountId;
    }

    public void setAccountId(Long accountId) {
        this.accountId = accountId;
    }

    public List<GroupItem> getGroups() {
        return groups;
    }

    public void setGroups(List<GroupItem> groups) {
        this.groups = groups;
    }

    public SnapshotItem getSnapshot() {
        return snapshot;
    }

    public void setSnapshot(SnapshotItem snapshot) {
        this.snapshot = snapshot;
    }

    public List<EventItem> getEvents() {
        return events;
    }

    public void setEvents(List<EventItem> events) {
        this.events = events;
    }

    public static class GroupItem {
        private String chatKey;
        private String title;

        public String getChatKey() {
            return chatKey;
        }

        public void setChatKey(String chatKey) {
            this.chatKey = chatKey;
        }

        public String getTitle() {
            return title;
        }

        public void setTitle(String title) {
            this.title = title;
        }
    }

    public static class SnapshotItem {
        private String chatKey;
        private List<ParticipantItem> participants;

        public String getChatKey() {
            return chatKey;
        }

        public void setChatKey(String chatKey) {
            this.chatKey = chatKey;
        }

        public List<ParticipantItem> getParticipants() {
            return participants;
        }

        public void setParticipants(List<ParticipantItem> participants) {
            this.participants = participants;
        }
    }

    public static class ParticipantItem {
        private String memberKey;
        private String phone;
        private String displayName;
        /** member | admin | super；不认识的值按 member 收。 */
        private String roleType;

        public String getMemberKey() {
            return memberKey;
        }

        public void setMemberKey(String memberKey) {
            this.memberKey = memberKey;
        }

        public String getPhone() {
            return phone;
        }

        public void setPhone(String phone) {
            this.phone = phone;
        }

        public String getDisplayName() {
            return displayName;
        }

        public void setDisplayName(String displayName) {
            this.displayName = displayName;
        }

        public String getRoleType() {
            return roleType;
        }

        public void setRoleType(String roleType) {
            this.roleType = roleType;
        }
    }

    public static class EventItem {
        private String chatKey;
        private String memberKey;
        private String actorKey;
        private String actorName;
        private String eventType;
        /** epoch 秒。在线事件这一位是**观测时刻**（spec §15#5），不是真实发生时刻。 */
        private Long occurredAtEpochSec;
        private String dedupKey;
        private String source;
        private String rawType;
        private String rawSubtype;
        private String bodySnapshot;

        public String getChatKey() {
            return chatKey;
        }

        public void setChatKey(String chatKey) {
            this.chatKey = chatKey;
        }

        public String getMemberKey() {
            return memberKey;
        }

        public void setMemberKey(String memberKey) {
            this.memberKey = memberKey;
        }

        public String getActorKey() {
            return actorKey;
        }

        public void setActorKey(String actorKey) {
            this.actorKey = actorKey;
        }

        public String getActorName() {
            return actorName;
        }

        public void setActorName(String actorName) {
            this.actorName = actorName;
        }

        public String getEventType() {
            return eventType;
        }

        public void setEventType(String eventType) {
            this.eventType = eventType;
        }

        public Long getOccurredAtEpochSec() {
            return occurredAtEpochSec;
        }

        public void setOccurredAtEpochSec(Long occurredAtEpochSec) {
            this.occurredAtEpochSec = occurredAtEpochSec;
        }

        public String getDedupKey() {
            return dedupKey;
        }

        public void setDedupKey(String dedupKey) {
            this.dedupKey = dedupKey;
        }

        public String getSource() {
            return source;
        }

        public void setSource(String source) {
            this.source = source;
        }

        public String getRawType() {
            return rawType;
        }

        public void setRawType(String rawType) {
            this.rawType = rawType;
        }

        public String getRawSubtype() {
            return rawSubtype;
        }

        public void setRawSubtype(String rawSubtype) {
            this.rawSubtype = rawSubtype;
        }

        public String getBodySnapshot() {
            return bodySnapshot;
        }

        public void setBodySnapshot(String bodySnapshot) {
            this.bodySnapshot = bodySnapshot;
        }
    }
}

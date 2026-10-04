package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/**
 * B28 P2 — AI transfer-to-human rule.
 *
 * <p>A tenant-owned rule that, when an inbound message matches its keywords
 * ({@code any} or {@code all}), pushes the owning conversation into the takeover
 * queue ({@code WAITING_TAKEOVER}). {@code enabled=0} rules are skipped by the
 * evaluator; {@code priority} orders evaluation (higher first).
 */
@Data
@TableName("ai_transfer_rule")
public class AiTransferRule {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    /** Human-readable name shown in the rule list. */
    private String ruleName;
    /** "any" (match if one keyword is present) or "all" (match only if every keyword is present). */
    private String matchMode;
    /** Comma / Chinese comma / semicolon separated keyword list, stored raw and split at eval time. */
    private String keywords;
    /** Reason stamped onto the conversation when this rule trips (null = rule name is used). */
    private String transferReason;
    /** 0 disabled, 1 enabled. */
    private Integer enabled;
    /** Higher number = evaluated first; ties broken by id ascending. */
    private Integer priority;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}

package com.smartscrm.server.web.vo;

import java.util.List;

/**
 * 账号的**运行时**指纹参数（B14 指纹注入，spec §1）。
 *
 * <p>与 {@code FingerprintProfile} 的区别：档案是"存了什么"，这里是"客户端该做什么"。
 * 后端在这里就把档案解析干净（brands 的 JSON 拆成对象、噪声种子转成数字），客户端拿到
 * 直接用——否则每个客户端都要各写一份解析，两边迟早漂移。
 *
 * <p>每个参数都可空，且**可空是语义不是缺省**：null = 该项不改（spec R7）。客户端不得为
 * null 补任何默认值——不猜时区、不猜核数。同理，某一个字段解析失败只让它自己为 null，
 * 其余字段照常返回，绝不能因为一处坏了让整个账号的指纹全丢。
 */
public record FingerprintRuntimeVO(
    Long profileId,
    Long seed,
    String userAgent,
    String uaPlatform,
    String uaPlatformVersion,
    List<BrandVO> brands,
    String locale,
    String timezone,
    Integer hardwareConcurrency,
    Integer deviceMemory,
    String webglVendor,
    String webglRenderer,
    Long canvasNoiseSeed,
    Long audioNoiseSeed
) {
    /** Client Hints 的一项 brand。缺 brand / version 时各自为 null，不补空串（R7）。 */
    public record BrandVO(String brand, String version) {
    }
}

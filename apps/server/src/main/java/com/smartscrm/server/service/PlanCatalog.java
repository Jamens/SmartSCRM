package com.smartscrm.server.service;

import com.smartscrm.server.web.vo.PlanDefVO;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * B12 模拟支付门控的预设套餐目录。仅作演示：价格与限额为写死的常量，
 * 真实计费应来自独立的订单 / 支付系统。前端通过 GET /api/tenant/plans 拉取本目录，
 * 选择后由客户端模拟支付宝支付，再调用 POST /api/tenant/activate-plan 把限额写入租户。
 */
public final class PlanCatalog {

    public static final PlanDefVO BASIC = new PlanDefVO("BASIC", 0, 3, 100_000, 50_000);
    public static final PlanDefVO PRO = new PlanDefVO("PRO", 199, 10, 1_000_000, 500_000);
    public static final PlanDefVO FLAGSHIP = new PlanDefVO("FLAGSHIP", 599, 50, 5_000_000, 3_000_000);

    private static final List<PlanDefVO> ALL = List.of(BASIC, PRO, FLAGSHIP);
    private static final Map<String, PlanDefVO> BY_CODE = ALL.stream()
            .collect(Collectors.toMap(PlanDefVO::code, Function.identity()));

    public static List<PlanDefVO> all() {
        return ALL;
    }

    public static PlanDefVO getByCode(String code) {
        return code == null ? null : BY_CODE.get(code);
    }

    private PlanCatalog() {
    }
}

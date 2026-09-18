package com.smartscrm.server.common;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import java.util.List;

public record PageResult<T>(List<T> records, long total, long page, long pageSize) {

    public static <T> PageResult<T> of(Page<T> page) {
        return new PageResult<>(page.getRecords(), page.getTotal(), page.getCurrent(), page.getSize());
    }

    public static <T> PageResult<T> of(List<T> records, long total, long page, long pageSize) {
        return new PageResult<>(records, total, page, pageSize);
    }
}

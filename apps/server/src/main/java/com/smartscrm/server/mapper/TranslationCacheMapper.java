package com.smartscrm.server.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.smartscrm.server.entity.TranslationCache;
import org.apache.ibatis.annotations.Select;

public interface TranslationCacheMapper extends BaseMapper<TranslationCache> {

    @Select("SELECT COUNT(*) FROM translation_cache WHERE tenant_id = #{tenantId}")
    long countKeys(Long tenantId);

    @Select("SELECT COALESCE(SUM(hit_count), 0) FROM translation_cache WHERE tenant_id = #{tenantId}")
    long sumHits(Long tenantId);
}

-- P5: 线路清单扩到 7 条。列的类型与默认值不变，只把注释同步成新的取值表，
-- 避免库里写着四条、接口收着七条。
ALTER TABLE `translation_setting`
    MODIFY COLUMN `channel` VARCHAR(4) NOT NULL DEFAULT '1'
        COMMENT '1=Google 2=DeepL 3=ChatGPT 4=Gemini 5=百度 6=有道 7=腾讯';

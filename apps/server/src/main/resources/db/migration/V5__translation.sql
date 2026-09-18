-- P5: translation center (checklist B2) — settings, node metadata, translated-text
-- cache and the seed dictionary for the simulated engine.
-- Everything is local mock data: node `url` values are display only and are never
-- requested by any code path. Delays are base values plus jitter, not measurements.

CREATE TABLE `translation_setting`
(
    `id`                           BIGINT      NOT NULL AUTO_INCREMENT,
    `tenant_id`                    BIGINT      NOT NULL,
    `scope`                        VARCHAR(16) NOT NULL DEFAULT 'global' COMMENT 'global | customer (customer reserved for the chat-history phase)',
    `scope_key`                    VARCHAR(64) NULL COMMENT 'customer id when scope=customer',
    `server`                       VARCHAR(16) NOT NULL DEFAULT 'sg' COMMENT 'translation node name',
    `server_mode`                  VARCHAR(8)  NOT NULL DEFAULT 'auto' COMMENT 'auto | manual',
    `channel`                      VARCHAR(4)  NOT NULL DEFAULT '1' COMMENT '1=Google 2=DeepL 3=ChatGPT 4=Gemini',
    `receive_enabled`              TINYINT(1)  NOT NULL DEFAULT 1,
    `receive_from_lang`            VARCHAR(16) NOT NULL DEFAULT '' COMMENT 'empty = auto detect',
    `receive_to_lang`              VARCHAR(16) NOT NULL DEFAULT 'zh-CN',
    `send_enabled`                 TINYINT(1)  NOT NULL DEFAULT 1,
    `send_from_lang`               VARCHAR(16) NOT NULL DEFAULT '',
    `send_to_lang`                 VARCHAR(16) NOT NULL DEFAULT 'en',
    `voice_enabled`                TINYINT(1)  NOT NULL DEFAULT 1 COMMENT 'stored only; voice translation is not implemented in this phase',
    `preview_enabled`              TINYINT(1)  NOT NULL DEFAULT 1 COMMENT 'input live preview',
    `enter_to_send`                TINYINT(1)  NOT NULL DEFAULT 0 COMMENT 'Enter = translate then send',
    `disable_chinese`              TINYINT(1)  NOT NULL DEFAULT 1,
    `disable_chinese_prevent_send` TINYINT(1)  NOT NULL DEFAULT 0,
    `created_at`                   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`                   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_tset_tenant_scope` (`tenant_id`, `scope`, `scope_key`),
    CONSTRAINT `fk_tset_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='translation settings per tenant';

CREATE TABLE `translation_node`
(
    `id`            BIGINT       NOT NULL AUTO_INCREMENT,
    `name`          VARCHAR(16)  NOT NULL COMMENT 'sg | my | my2 | id | hk | uk | us',
    `label`         VARCHAR(32)  NOT NULL,
    `url`           VARCHAR(255) NOT NULL COMMENT 'display only; never requested',
    `base_delay_ms` INT          NOT NULL DEFAULT 0 COMMENT 'simulated baseline, not a measurement',
    `reachable`     TINYINT(1)   NOT NULL DEFAULT 1,
    `sort`          INT          NOT NULL DEFAULT 0,
    `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_tnode_name` (`name`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='translation nodes (metadata only)';

CREATE TABLE `translation_cache`
(
    `id`          BIGINT       NOT NULL AUTO_INCREMENT,
    `tenant_id`   BIGINT       NOT NULL,
    `cache_key`   VARCHAR(96)  NOT NULL,
    `type`        VARCHAR(8)   NOT NULL COMMENT 'receive | send',
    `channel`     VARCHAR(4)   NOT NULL,
    `from_lang`   VARCHAR(16)  NOT NULL DEFAULT '' COMMENT 'empty = auto detect',
    `to_lang`     VARCHAR(16)  NOT NULL,
    `source_text` TEXT         NOT NULL,
    `target_text` TEXT         NOT NULL,
    `partial`     TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1 = dictionary did not cover everything',
    `hit_count`   INT          NOT NULL DEFAULT 0,
    `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_tcache_tenant_key` (`tenant_id`, `cache_key`),
    KEY `idx_tcache_tenant_hit` (`tenant_id`, `hit_count`),
    CONSTRAINT `fk_tcache_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='translated text cache, tenant scoped';

CREATE TABLE `translation_phrase`
(
    `id`         BIGINT       NOT NULL AUTO_INCREMENT,
    `phrase_key` VARCHAR(64)  NOT NULL COMMENT 'stable slug for a phrase',
    `lang_code`  VARCHAR(16)  NOT NULL,
    `text`       VARCHAR(255) NOT NULL,
    `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_tphrase_lang` (`phrase_key`, `lang_code`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='seed dictionary for the simulated engine';

-- 7 nodes. `my2` is deliberately unreachable so that "delay = null -> auto pick skips it"
-- is a state the UI and the API can actually be tested against.
INSERT INTO translation_node (name, label, url, base_delay_ms, reachable, sort) VALUES
('sg',  '新加坡', 'https://translate-sg.scrm.local',  20, 1, 0),
('my',  '马来西亚', 'https://translate-my.scrm.local', 45, 1, 1),
('my2', '马来西亚备份', 'https://translate-my2.scrm.local', 60, 0, 2),
('id',  '印尼',   'https://translate-id.scrm.local',  70, 1, 3),
('hk',  '香港',   'https://translate-hk.scrm.local',  90, 1, 4),
('uk',  '英国',   'https://translate-uk.scrm.local', 130, 1, 5),
('us',  '美国',   'https://translate-us.scrm.local', 180, 1, 6);

-- DEMO tenant settings row.
SET @tid = (SELECT id FROM tenant WHERE invite_code = 'DEMO0001' LIMIT 1);
INSERT INTO translation_setting (tenant_id) VALUES (@tid);

-- Simulated dictionary: 41 SCRM phrases x 8 languages. Unknown words stay untranslated
-- on purpose (that is what `partial` reports), so this list only needs the common lines.
-- lang set: zh-CN en vi id lo hi my ms
INSERT INTO translation_phrase (phrase_key, lang_code, text) VALUES
('greet_hello','zh-CN','你好'),('greet_hello','en','Hello'),('greet_hello','vi','Xin chào'),('greet_hello','id','Halo'),('greet_hello','lo','ສະບາຍດີ'),('greet_hello','hi','नमस्ते'),('greet_hello','my','မင်္ဂလာပါ'),('greet_hello','ms','Hai'),
('greet_service','zh-CN','很高兴为你服务'),('greet_service','en','glad to help you'),('greet_service','vi','rất vui được phục vụ bạn'),('greet_service','id','senang melayani Anda'),('greet_service','lo','ດີໃຈທີ່ໄດ້ບໍລິການ'),('greet_service','hi','सेवा करके खुशी हुई'),('greet_service','my','ဝန်ဆောင်မှုပေးရတာ ဝမ်းသာပါတယ်'),('greet_service','ms','gembira membantu anda'),
('ask_help','zh-CN','请问有什么可以帮您'),('ask_help','en','how can I help you'),('ask_help','vi','bạn cần tôi giúp gì'),('ask_help','id','ada yang bisa dibantu'),('ask_help','lo','ຕ້ອງການໃຫ້ຊ່ວຍຫຍັງ'),('ask_help','hi','मैं क्या मदद करूँ'),('ask_help','my','ဘာများ ကူညီပေးရမလဲ'),('ask_help','ms','apa yang boleh saya bantu'),
('thanks','zh-CN','感谢你的支持'),('thanks','en','thank you for your support'),('thanks','vi','cảm ơn bạn đã ủng hộ'),('thanks','id','terima kasih atas dukungannya'),('thanks','lo','ຂອບໃຈທີ່ສະໜັບສະໜູນ'),('thanks','hi','आपके समर्थन के लिए धन्यवाद'),('thanks','my','ကျေးဇူးတင်ပါတယ်'),('thanks','ms','terima kasih atas sokongan anda'),
('ship_done','zh-CN','订单已发货'),('ship_done','en','your order has been shipped'),('ship_done','vi','đơn hàng đã được gửi'),('ship_done','id','pesanan sudah dikirim'),('ship_done','lo','ອໍານາດຖືກສົ່ງແລ້ວ'),('ship_done','hi','आपका आदेश भेज दिया गया है'),('ship_done','my','မှာယူမှု ပို့လိုက်ပါပြီ'),('ship_done','ms','pesanan anda telah dihantar'),
('ship_done_ok','zh-CN','订单已发货成功'),('ship_done_ok','en','your order has been shipped successfully'),('ship_done_ok','vi','đơn hàng đã gửi thành công'),('ship_done_ok','id','pesanan berhasil dikirim'),('ship_done_ok','lo','ອໍານາດສົ່ງສຳເລັດ'),('ship_done_ok','hi','आदेश सफलतापूर्वक भेजा गया'),('ship_done_ok','my','ပို့ရေးအောင်မြင်ပါပြီ'),('ship_done_ok','ms','pesanan berjaya dihantar'),
('track_no','zh-CN','物流单号如下'),('track_no','en','the tracking number is below'),('track_no','vi','mã vận đơn như sau'),('track_no','id','nomor resi berikut'),('track_no','lo','ໝາຍເລກຕິດຕາມ'),('track_no','hi','ट्रैकिंग नंबर नीचे है'),('track_no','my','နံပါတ်ကို အောက်တွင်'),('track_no','ms','nombor penjejakan di bawah'),
('eta_3days','zh-CN','预计三天到货'),('eta_3days','en','estimated arrival in three days'),('eta_3days','vi','dự kiến giao trong ba ngày'),('eta_3days','id','perkiraan tiba tiga hari'),('eta_3days','lo','ປະມານສາມມື້'),('eta_3days','hi','अनुमानित तीन दिन में'),('eta_3days','my','သုံးရက်ခန့်'),('eta_3days','ms','anggaran tiga hari'),
('promo_now','zh-CN','现在下单有优惠'),('promo_now','en','order now for a discount'),('promo_now','vi','đặt hàng ngay để được giảm giá'),('promo_now','id','pesan sekarang ada diskon'),('promo_now','lo','ສັ່ງຊື້ຕອນນີ້ມີສ່ວນຫຼຸດ'),('promo_now','hi','अभी ऑर्डर करें, छूट पाएं'),('promo_now','my','ယခုမှာလျှင် နှုန်းထားကောင်း'),('promo_now','ms','pesan sekarang dapat diskaun'),
('promo_today','zh-CN','限时优惠，今天截止'),('promo_today','en','limited offer, ends today'),('promo_today','vi','ưu đãi có thời hạn, kết thúc hôm nay'),('promo_today','id','promo terbatas, berakhir hari ini'),('promo_today','lo','ໂປຣຈຳກັດ, ໝົດວັນນີ້'),('promo_today','hi','सीमित ऑफ़र, आज समाप्त'),('promo_today','my','ယနေ့နောက်ဆုံးသတ်မှတ်'),('promo_today','ms','tawaran terhad, tamat hari ini'),
('wait_check','zh-CN','请稍等，我帮你查询'),('wait_check','en','please wait, let me check'),('wait_check','vi','vui lòng đợi, tôi kiểm tra'),('wait_check','id','tunggu sebentar, saya cek'),('wait_check','lo','ກະລຸນາລໍຖ້າ'),('wait_check','hi','कृपया रुकें, मैं देखता हूँ'),('wait_check','my','ခဏစောင့်ပါ'),('wait_check','ms','sila tunggu, saya semak'),
('stock_hold','zh-CN','已为你保留库存'),('stock_hold','en','stock reserved for you'),('stock_hold','vi','đã giữ hàng cho bạn'),('stock_hold','id','stok kami reservasikan'),('stock_hold','lo','ກັນສິນຄ້າໃຫ້ແລ້ວ'),('stock_hold','hi','आपके लिए स्टॉक आरक्षित है'),('stock_hold','my','သင့်အတွက် နေရာယူထားပါပြီ'),('stock_hold','ms','stok rizab untuk anda'),
('pay_now','zh-CN','请尽快完成付款'),('pay_now','en','please complete the payment soon'),('pay_now','vi','vui lòng thanh toán sớm'),('pay_now','id','mohon selesaikan pembayaran'),('pay_now','lo','ກະລຸນາຊຳລະເງິນ'),('pay_now','hi','कृपया भुगतान पूरा करें'),('pay_now','my','ငွေပေးချေမှု အမြန်ဆုံး'),('pay_now','ms','sila selesaikan bayaran'),
('pay_pending','zh-CN','还未收到你的付款'),('pay_pending','en','we have not received your payment'),('pay_pending','vi','chưa nhận được thanh toán của bạn'),('pay_pending','id','kami belum menerima pembayaran Anda'),('pay_pending','lo','ຍັງບໍ່ໄດ້ຮັບການຊຳລະ'),('pay_pending','hi','हमें भुगतान नहीं मिला'),('pay_pending','my','ငွေလက်ခံရရှိခြင်း မရှိသေး'),('pay_pending','ms','kami belum menerima bayaran anda'),
('refund_ok','zh-CN','退款已经处理'),('refund_ok','en','the refund has been processed'),('refund_ok','vi','hoàn tiền đã được xử lý'),('refund_ok','id','pengembalian dana diproses'),('refund_ok','lo','ການ refunded ດຳເນີນແລ້ວ'),('refund_ok','hi','रिफंड प्रोसेस हो गया'),('refund_ok','my','ငွေပြန်အမ်းပြီး'),('refund_ok','ms','bayaran balik telah diproses'),
('ask_address','zh-CN','请提供收货地址'),('ask_address','en','please provide your delivery address'),('ask_address','vi','vui lòng cung cấp địa chỉ nhận hàng'),('ask_address','id','mohon berikan alamat pengiriman'),('ask_address','lo','ກະລຸນາໃຫ້ທີ່ຢູ່'),('ask_address','hi','कृपया पता दें'),('ask_address','my','လိပ်စာ ပေးပို့ပါ'),('ask_address','ms','sila berikan alamat penghantaran'),
('confirm_order','zh-CN','请确认订单信息'),('confirm_order','en','please confirm your order details'),('confirm_order','vi','vui lòng xác nhận đơn hàng'),('confirm_order','id','mohon konfirmasi pesanan'),('confirm_order','lo','ກະລຸນາຢືນຢັນ'),('confirm_order','hi','ऑर्डर की पुष्टि करें'),('confirm_order','my','မှာယူမှု အတည်ပြုပါ'),('confirm_order','ms','sila sahbut pesanan'),
('after_sale','zh-CN','售后问题随时找我'),('after_sale','en','reach me anytime for after-sales'),('after_sale','vi','liên hệ tôi bất cứ lúc nào'),('after_sale','id','hubungi saya kapan pun'),('after_sale','lo','ຕິດຕໍ່ມາໄດ້ເລີຍ'),('after_sale','hi','बिक्री के बाद कभी भी लिखें'),('after_sale','my','အရောင်း 후 မေးမြန်းနိုင်'),('after_sale','ms','hubungi saya bila-bila masa'),
('broken_item','zh-CN','商品有损坏吗'),('broken_item','en','is the item damaged'),('broken_item','vi','hàng bị hư hỏng phải không'),('broken_item','id','apakah barang rusak'),('broken_item','lo','ສິນຄ້າເສຍຫາຍບໍ່'),('broken_item','hi','क्या सामान टूटा है'),('broken_item','my','ပစ္စည်း ပျက်စီးနေပါသလဲ'),('broken_item','ms','adakah barang rosak'),
('send_within','zh-CN','我们会在两天内寄出'),('send_within','en','we will send it within two days'),('send_within','vi','chúng tôi sẽ gửi trong hai ngày'),('send_within','id','kami kirim dalam dua hari'),('send_within','lo','ພວກເຮົາຈະສົ່ງໃນສອງມື້'),('send_within','hi','हम दो दिन में भेज देंगे'),('send_within','my','နှစ်ရက်အတွင်း ပို့ပေးပါမည်'),('send_within','ms','kami akan hantar dalam dua hari'),
('price_hint','zh-CN','这个价格已经很优惠了'),('price_hint','en','this price is already very good'),('price_hint','vi','giá này đã rất tốt rồi'),('price_hint','id','harga ini sudah sangat baik'),('price_hint','lo','ຣາຄານີ້ດີຫຼາຍແລ້ວ'),('price_hint','hi','यह कीमत बहुत अच्छी है'),('price_hint','my','ဈေးနှုန်း အလွန်ကောင်း'),('price_hint','ms','harga ini sudah sangat baik'),
('discount_10','zh-CN','可以给你十个百分点的折扣'),('discount_10','en','I can give you a ten percent discount'),('discount_10','vi','tôi có thể giảm cho bạn mười phần trăm'),('discount_10','id','saya bisa memberi diskon sepuluh persen'),('discount_10','lo','ສ່ວນຫຼຸດ ສິບເປີເຊັນ'),('discount_10','hi','मैं दस प्रतिशत छूट दे सकता हूँ'),('discount_10','my','ဆယ်ရာခိုင်နှုန်း လျှော့ပေးနိုင်'),('discount_10','ms','saya boleh beri diskaun sepuluh peratus'),
('min_order','zh-CN','最低起订量是一百件'),('min_order','en','the minimum order is one hundred pieces'),('min_order','vi','đơn tối thiểu là một trăm cái'),('min_order','id','pesanan minimum seratus buah'),('min_order','lo','ຄ່ານ້ອຍສຸດ ໜຶ່ງຮ້ອຍຊິ້ນ'),('min_order','hi','न्यूनतम ऑर्डर सौ है'),('min_order','my','အနိမ့်ဆုံး မှာယူမှု နောက်ခေါင်း'),('min_order','ms','pesanan minimum seratus unit'),
('welcome_back','zh-CN','欢迎再次光临'),('welcome_back','en','welcome back'),('welcome_back','vi','chào mừng trở lại'),('welcome_back','id','selamat datang kembali'),('welcome_back','lo','ຍິນດີຕ້ອນຮັບກັບມາ'),('welcome_back','hi','फिर से स्वागत है'),('welcome_back','my','ပြန်လည်ကြိုဆိုပါတယ်'),('welcome_back','ms','selamat kembali'),
('bye','zh-CN','祝你生活愉快'),('bye','en','wish you a good day'),('bye','vi','chúc bạn một ngày tốt lành'),('bye','id','semoga harimu menyenangkan'),('bye','lo','ຂໍໃຫ້ມື້ດີ'),('bye','hi','आपका दिन शुभ हो'),('bye','my','နေကောင်းပါစေ'),('bye','ms','semoga hari anda baik'),
('festival_ok','zh-CN','节日快乐'),('festival_ok','en','happy festival'),('festival_ok','vi','chúc mừng lễ'),('festival_ok','id','selamat merayakan hari raya'),('festival_ok','lo','ສຸກຂ່າວຖັນມື້'),('festival_ok','hi','त्योहार की शुभकामनाएँ'),('festival_ok','my','ပွဲတော်အချိန် နှုတ်ခွား'),('festival_ok','ms','selamat merayakan'),
('new_year','zh-CN','新年快乐'),('new_year','en','happy new year'),('new_year','vi','chúc mừng năm mới'),('new_year','id','selamat tahun baru'),('new_year','lo','ສຸກຂ່າວປີໃໝ່'),('new_year','hi','नया वर्ष की शुभकामनाएँ'),('new_year','my','နွစ်ဖြစ်သစ်နှစ်'),('new_year','ms','selamat tahun baru'),
('order_confirm_q','zh-CN','要现在下单吗'),('order_confirm_q','en','shall we place the order now'),('order_confirm_q','vi','đặt hàng luôn nhé'),('order_confirm_q','id','pesan sekarang'),('order_confirm_q','lo','ຈະສັ່ງຊື້ຕອນນີ້ບໍ່'),('order_confirm_q','hi','क्या अभी ऑर्डर करें'),('order_confirm_q','my','ယခုမှာမလား'),('order_confirm_q','ms','mahu pesan sekarang'),
('need_time','zh-CN','我需要再考虑一下'),('need_time','en','I need more time to think'),('need_time','vi','tôi cần suy nghĩ thêm'),('need_time','id','saya perlu waktu untuk berpikir'),('need_time','lo','ຂໍເວລາຄິດກ່ອນ'),('need_time','hi','मुझे सोचने का समय चाहिए'),('need_time','my','အနည်းငယ် စဉ်းစားရန်'),('need_time','ms','saya perlu masa berfikir'),
('in_stock','zh-CN','这个有现货'),('in_stock','en','this one is in stock'),('in_stock','vi','cái này còn hàng'),('in_stock','id','barang ini tersedia'),('in_stock','lo','ອັນນີ້ມີສິນຄ້າ'),('in_stock','hi','यह स्टॉक में है'),('in_stock','my','ဒီပစ္စည်း ရှိနေပါတယ်'),('in_stock','ms','yang ini ada stok'),
('out_stock','zh-CN','暂时缺货了'),('out_stock','en','it is out of stock for now'),('out_stock','vi','tạm hết hàng'),('out_stock','id','sedang habis stok'),('out_stock','lo','ຊົ່ວຄາວ ຫມົດສິນຄ້າ'),('out_stock','hi','अभी स्टॉक नहीं है'),('out_stock','my','ယာယီ ကုန်သွားပါပြီ'),('out_stock','ms','kehabisan stok buat masa ini'),
('size_chart','zh-CN','尺寸表发给你了'),('size_chart','en','I have sent you the size chart'),('size_chart','vi','đã gửi bảng size cho bạn'),('size_chart','id','tabel ukuran sudah saya kirim'),('size_chart','lo','ສົ່ງຕາຕະລາງຂະໜາດແລ້ວ'),('size_chart','hi','साइज़ चार्ट भेज दिया'),('size_chart','my','အရွယ်အစား ဇယား ပို့ပြီး'),('size_chart','ms','carta saiz telah dihantar'),
('color_q','zh-CN','你要什么颜色'),('color_q','en','which colour do you want'),('color_q','vi','bạn muốn màu nào'),('color_q','id','Anda mau warna apa'),('color_q','lo','ຕ້ອງການສີໃດ'),('color_q','hi','आपको कौन सा रंग चाहिए'),('color_q','my','ဘယ်အရောင် လိုချင်လဲ'),('color_q','ms','anda mahu warna apa'),
('reply_later','zh-CN','稍后回复你'),('reply_later','en','I will reply later'),('reply_later','vi','tôi sẽ trả lời sau'),('reply_later','id','nanti saya balas'),('reply_later','lo','ຈະຕອບກັບພາຍຫຼັງ'),('reply_later','hi','मैं बाद में जवाब दूँगा'),('reply_later','my','နောက်မှ ပြန်ဖြေပါမယ်'),('reply_later','ms','saya akan balas kelak'),
('urgent','zh-CN','这个比较急'),('urgent','en','this one is quite urgent'),('urgent','vi','cái này khá gấp'),('urgent','id','ini cukup mendesak'),('urgent','lo','ອັນນີ້ດ່ວນ'),('urgent','hi','यह थोड़ा ज़रूरी है'),('urgent','my','ဒါ အနည်းငယ် အရေးတကြီး'),('urgent','ms','yang ini agak segera'),
('ok_k','zh-CN','好的'),('ok_k','en','ok'),('ok_k','vi','vâng'),('ok_k','id','baik'),('ok_k','lo','ດີ'),('ok_k','hi','ठीक है'),('ok_k','my','ဟုတ်ကဲ့'),('ok_k','ms','baik'),
('sorry','zh-CN','非常抱歉'),('sorry','en','we are very sorry'),('sorry','vi','rất xin lỗi bạn'),('sorry','id','mohon maaf'),('sorry','lo','ຂໍໂທດຢ່າງຍິ່ງ'),('sorry','hi','काफी माफ़ी'),('sorry','my','တကယ်ပဲ ပြစ်မှား'),('sorry','ms','kami mohon maaf'),
('payment_link','zh-CN','付款链接在这里'),('payment_link','en','the payment link is here'),('payment_link','vi','link thanh toán ở đây'),('payment_link','id','tautan pembayaran di sini'),('payment_link','lo','ລິ້ງຊຳລະເງິນ'),('payment_link','hi','भुगतान लिंक यहाँ है'),('payment_link','my','ငွေပေးချေမှု link ဤနေရာ'),('payment_link','ms','pautan bayaran di sini'),
('track_hint','zh-CN','你可以凭单号查询物流'),('track_hint','en','you can track the parcel with the number'),('track_hint','vi','bạn có thể tra cứu vận đơn'),('track_hint','id','Anda bisa lacak dengan nomor resi'),('track_hint','lo','ສາມາດຕິດຕາມໄດ້'),('track_hint','hi','आप नंबर से ट्रैक कर सकते हैं'),('track_hint','my','နံပါတ်ဖြင့် စစ်ဆေးနိုင်'),('track_hint','ms','anda boleh jejak dengan nombor'),
('catalog','zh-CN','目录已经发给你了'),('catalog','en','the catalogue has been sent to you'),('catalog','vi','catalogue đã gửi cho bạn'),('catalog','id','katalog sudah dikirim'),('catalog','lo','ໄດ້ສົ່ງລາຍການແລ້ວ'),('catalog','hi','कैटलॉग भेज दिया गया'),('catalog','my','စာရင်း ပို့ပြီးပါပြီ'),('catalog','ms','katalog telah dihantar'),
('rate_us','zh-CN','麻烦给个五星好评'),('rate_us','en','please give us a five star review'),('rate_us','vi','hãy cho tôi đánh giá năm sao'),('rate_us','id','mohon beri ulasan bintang lima'),('rate_us','lo','ກະລຸນາໃຫ້ ດາມ'),('rate_us','hi','कृपया पाँच स्टार रेटिंग दें'),('rate_us','my','ကြယ်ငါးပွင့် ဖြင့်'),('rate_us','ms','sila beri ulasan lima bintang');

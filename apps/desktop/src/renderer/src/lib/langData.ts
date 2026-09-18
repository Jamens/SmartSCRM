export interface Language {
  code: string
  zh: string
  en: string
}

const L = (code: string, zh: string, en: string): Language => ({ code, zh, en })

/** Full candidate list; shared by the Google and Gemini channels. */
export const allLanguages: Language[] = [
  L('af', '南非荷兰语', 'Afrikaans'), L('sq', '阿尔巴尼亚语', 'Albanian'), L('am', '阿姆哈拉语', 'Amharic'),
  L('ar', '阿拉伯语', 'Arabic'), L('hy', '亚美尼亚语', 'Armenian'), L('az', '阿塞拜疆语', 'Azerbaijani'),
  L('eu', '巴斯克语', 'Basque'), L('be', '白俄罗斯语', 'Belarusian'), L('bn', '孟加拉语', 'Bengali'),
  L('bs', '波斯尼亚语', 'Bosnian'), L('bg', '保加利亚语', 'Bulgarian'), L('ca', '加泰罗尼亚语', 'Catalan'),
  L('ceb', '宿务语', 'Cebuano'), L('zh-CN', '简体中文', 'Chinese (Simplified)'), L('zh-TW', '繁体中文', 'Chinese (Traditional)'),
  L('co', '科西嘉语', 'Corsican'), L('hr', '克罗地亚语', 'Croatian'), L('cs', '捷克语', 'Czech'),
  L('da', '丹麦语', 'Danish'), L('nl', '荷兰语', 'Dutch'), L('en', '英语', 'English'),
  L('eo', '世界语', 'Esperanto'), L('et', '爱沙尼亚语', 'Estonian'), L('tl', '菲律宾语', 'Filipino'),
  L('fi', '芬兰语', 'Finnish'), L('fr', '法语', 'French'), L('fy', '弗里斯兰语', 'Frisian'),
  L('gl', '加利西亚语', 'Galician'), L('ka', '格鲁吉亚语', 'Georgian'), L('de', '德语', 'German'),
  L('el', '希腊语', 'Greek'), L('gu', '古吉拉特语', 'Gujarati'), L('ht', '海地克里奥尔语', 'Haitian Creole'),
  L('ha', '豪萨语', 'Hausa'), L('haw', '夏威夷语', 'Hawaiian'), L('he', '希伯来语', 'Hebrew'),
  L('hi', '印地语', 'Hindi'), L('hmn', '苗语', 'Hmong'), L('hu', '匈牙利语', 'Hungarian'),
  L('is', '冰岛语', 'Icelandic'), L('ig', '伊博语', 'Igbo'), L('id', '印尼语', 'Indonesian'),
  L('ga', '爱尔兰语', 'Irish'), L('it', '意大利语', 'Italian'), L('ja', '日语', 'Japanese'),
  L('jv', '爪哇语', 'Javanese'), L('kn', '卡纳达语', 'Kannada'), L('kk', '哈萨克语', 'Kazakh'),
  L('km', '高棉语', 'Khmer'), L('rw', '卢旺达语', 'Kinyarwanda'), L('ko', '韩语', 'Korean'),
  L('ku', '库尔德语', 'Kurdish'), L('ky', '吉尔吉斯语', 'Kyrgyz'), L('lo', '老挝语', 'Lao'),
  L('la', '拉丁语', 'Latin'), L('lv', '拉脱维亚语', 'Latvian'), L('lt', '立陶宛语', 'Lithuanian'),
  L('lb', '卢森堡语', 'Luxembourgish'), L('mk', '马其顿语', 'Macedonian'), L('mg', '马达加斯加语', 'Malagasy'),
  L('ms', '马来语', 'Malay'), L('ml', '马拉雅拉姆语', 'Malayalam'), L('mt', '马耳他语', 'Maltese'),
  L('mi', '毛利语', 'Maori'), L('mr', '马拉地语', 'Marathi'), L('mn', '蒙古语', 'Mongolian'),
  L('my', '缅甸语', 'Burmese'), L('ne', '尼泊尔语', 'Nepali'), L('nb', '挪威语', 'Norwegian'),
  L('or', '奥里亚语', 'Odia'), L('ps', '普什图语', 'Pashto'), L('fa', '波斯语', 'Persian'),
  L('pl', '波兰语', 'Polish'), L('pt', '葡萄牙语', 'Portuguese'), L('pa', '旁遮普语', 'Punjabi'),
  L('ro', '罗马尼亚语', 'Romanian'), L('ru', '俄语', 'Russian'), L('sm', '萨摩亚语', 'Samoan'),
  L('gd', '苏格兰盖尔语', 'Scots Gaelic'), L('sr', '塞尔维亚语', 'Serbian'), L('st', '塞索托语', 'Sesotho'),
  L('sn', '绍纳语', 'Shona'), L('sd', '信德语', 'Sindhi'), L('si', '僧伽罗语', 'Sinhala'),
  L('sk', '斯洛伐克语', 'Slovak'), L('sl', '斯洛文尼亚语', 'Slovenian'), L('so', '索马里语', 'Somali'),
  L('es', '西班牙语', 'Spanish'), L('su', '巽他语', 'Sundanese'), L('sw', '斯瓦希里语', 'Swahili'),
  L('sv', '瑞典语', 'Swedish'), L('tg', '塔吉克语', 'Tajik'), L('ta', '泰米尔语', 'Tamil'),
  L('tt', '鞑靼语', 'Tatar'), L('te', '泰卢固语', 'Telugu'), L('th', '泰语', 'Thai'),
  L('tr', '土耳其语', 'Turkish'), L('tk', '土库曼语', 'Turkmen'), L('uk', '乌克兰语', 'Ukrainian'),
  L('ur', '乌尔都语', 'Urdu'), L('ug', '维吾尔语', 'Uyghur'), L('uz', '乌兹别克语', 'Uzbek'),
  L('vi', '越南语', 'Vietnamese'), L('cy', '威尔士语', 'Welsh'), L('xh', '科萨语', 'Xhosa'),
  L('yi', '意第绪语', 'Yiddish'), L('yo', '约鲁巴语', 'Yoruba'), L('zu', '祖鲁语', 'Zulu')
]

const byCode = new Map(allLanguages.map((lang) => [lang.code, lang]))

function pick(codes: string[]): Language[] {
  return codes.map((code) => byCode.get(code)).filter((lang): lang is Language => !!lang)
}

/** R4: DeepL offers different source and target sets — `pt`/`nb` in, `pt-BR`/`ar`/`he`/`ms` out. */
export const deeplSourceLanguages: Language[] = pick([
  'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'hu', 'id', 'it', 'ja', 'ko',
  'lt', 'lv', 'nb', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'zh-CN'
])

export const deeplTargetLanguages: Language[] = pick([
  'ar', 'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'he', 'hu', 'id', 'it',
  'ja', 'ko', 'lt', 'lv', 'ms', 'nb', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr',
  'uk', 'zh-CN'
])

export const chatGptLanguages: Language[] = pick([
  'ar', 'de', 'en', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'ms', 'nl', 'pl', 'pt', 'ru',
  'th', 'tr', 'uk', 'ur', 'vi', 'zh-CN', 'zh-TW'
])

/** The eight languages the simulated engine can actually produce (spec §3.4 step 2). */
export const ENGINE_LANGUAGES = ['zh-CN', 'en', 'vi', 'id', 'lo', 'hi', 'my', 'ms']

export const TRANSLATION_CHANNELS = [
  { code: '1', label: 'Google' },
  { code: '2', label: 'DeepL' },
  { code: '3', label: 'ChatGPT' },
  { code: '4', label: 'Gemini' }
]

export function sourceLanguagesFor(channel: string): Language[] {
  if (channel === '2') return deeplSourceLanguages
  if (channel === '3') return chatGptLanguages
  return allLanguages
}

export function targetLanguagesFor(channel: string): Language[] {
  if (channel === '2') return deeplTargetLanguages
  if (channel === '3') return chatGptLanguages
  return allLanguages
}

export function languageName(code: string): string {
  if (!code) return '自动检测'
  const lang = byCode.get(code)
  return lang ? `${lang.zh}（${lang.code}）` : code
}

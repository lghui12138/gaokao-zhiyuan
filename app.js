const state = {
  data: null,
  view: "overview",
  query: "",
  discipline: "",
  domain: "",
  recommendation: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const CHILD_TYPES = ["稳健型", "均衡探索型", "冲刺型", "专业兴趣强", "城市资源型", "家庭预算敏感", "学术深造型", "就业导向型"];
const SUBJECT_TYPES = ["物理类", "历史类", "物理/理科", "历史/文科", "综合", "不确定"];
const RANK_LEVEL_LABELS = { undergraduate: "本科加分", vocational: "专科加分" };
const STRATEGIES = ["稳健", "均衡", "冲刺"];
const BUDGET_LEVELS = ["不敏感", "中等敏感", "高度敏感"];
const ALL_PROVINCES = [
  "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江", "上海", "江苏",
  "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "广西",
  "海南", "重庆", "四川", "贵州", "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆",
];

const DEFAULT_PROFILE = {
  childType: "均衡探索型",
  score: "593",
  rank: "17798",
  province: "江西",
  subject: "物理/理科",
  disciplineFocus: "08",
  interest: "计算机 软件 数据 数字媒体 虚拟现实",
  cities: "南昌 武汉 长沙 重庆 西安 杭州",
  redLines: "不接受高学费中外合作，不接受明显冷门且无法转专业",
  budget: "中等敏感",
  strategy: "均衡",
  abilityProfile: "语文120 英语124 数学102 物理77 化学82 生物88；语英较强，数学物理中等，化生基础较稳。",
};

const HIGH_TUITION_THRESHOLD = 30000;

const CANDIDATE_POOLS = [
  {
    id: "elite-platform",
    title: "985/211/双一流/C9 高平台院校池",
    stance: "冲刺/上探",
    bands: ["elite", "upper"],
    disciplines: ["07", "08", "10", "02", "12"],
    profiles: ["冲刺型", "学术深造型", "均衡探索型"],
    cities: ["北京", "上海", "南京", "武汉", "西安", "广州"],
    keywords: ["985", "211", "双一流", "C9", "学科评估", "博士点", "选择大学", "核心要素"],
    examples: ["双一流/985/211/C9 层次", "强学科平台", "高平台冲刺项"],
    risks: ["必须用当年本省位次和专业组核验可报边界", "不能只看学校光环，要确认专业和调剂可接受度"],
  },
  {
    id: "shanghai-city",
    title: "上海高校与长三角城市资源院校池",
    stance: "城市资源/就业实习",
    bands: ["elite", "upper", "middle"],
    disciplines: ["02", "08", "12", "05"],
    profiles: ["城市资源型", "就业导向型", "冲刺型", "均衡探索型"],
    cities: ["上海", "长三角", "苏州", "杭州"],
    keywords: ["上海高校", "上海", "城市", "实习", "就业", "金融", "国际商务", "会计"],
    examples: ["上海高校方向", "长三角产业与实习资源", "商科/工科城市平台"],
    risks: ["生活成本和竞争强度较高", "热门专业更需要位次安全边界"],
  },
  {
    id: "wuhan-city",
    title: "武汉高校与中部强区域院校池",
    stance: "稳妥平台/专业平衡",
    bands: ["upper", "middle", "foundation"],
    disciplines: ["07", "08", "10", "03", "12"],
    profiles: ["稳健型", "均衡探索型", "就业导向型", "专业兴趣强"],
    cities: ["武汉", "中部", "湖北", "省会"],
    keywords: ["武汉市的几所高校", "武汉", "二本三本", "城市", "大学", "专业大学与城市"],
    examples: ["武汉高校方向", "中部省会资源", "稳妥专业组合"],
    risks: ["要区分校区、批次和专业组层次", "二本三本材料需按当前政策口径复核"],
  },
  {
    id: "hongkong-macao",
    title: "港澳高校路径院校池",
    stance: "特殊机会/高成本",
    bands: ["elite", "upper", "middle"],
    disciplines: ["02", "08", "12", "05"],
    profiles: ["冲刺型", "城市资源型", "学术深造型"],
    cities: ["香港", "澳门", "港澳"],
    keywords: ["港澳", "港澳台院校", "港澳大学", "港大", "港澳学校专业汇总", "低分高就"],
    examples: ["港澳高校路径", "港澳学校专业汇总", "另辟蹊径读名校"],
    risks: ["学费和生活成本高，预算敏感家庭要谨慎", "申请规则、证书和培养地点必须逐项核验"],
    highCost: true,
  },
  {
    id: "science-research",
    title: "07 理学基础学科与深造院校池",
    stance: "基础学科/深造",
    bands: ["elite", "upper", "middle"],
    disciplines: ["07"],
    profiles: ["学术深造型", "专业兴趣强", "均衡探索型"],
    cities: ["北京", "上海", "武汉", "南京", "省会"],
    keywords: ["理学", "数学", "物理", "化学", "生物", "地质", "心理学", "深造"],
    examples: ["数学/物理/化学/生物方向", "地质/心理学资料方向", "基础学科深造路径"],
    risks: ["需要确认孩子是否愿意长期深造和承受基础课程", "理学不等同于所有理科可报专业"],
  },
  {
    id: "engineering-industry",
    title: "08 工学产业就业院校池",
    stance: "产业就业/工程实践",
    bands: ["elite", "upper", "middle", "foundation"],
    disciplines: ["08"],
    profiles: ["就业导向型", "专业兴趣强", "城市资源型", "均衡探索型"],
    cities: ["上海", "武汉", "长三角", "省会"],
    keywords: ["工学", "工科", "计算机", "机械", "土木", "建筑", "材料", "电力", "产业"],
    examples: ["计算机/机械/电气/土木/材料方向", "产业城市匹配", "工程实践路径"],
    risks: ["行业周期差异大，不能只按热门冷门判断", "要看归属学院、课程和实习资源"],
  },
  {
    id: "business-city",
    title: "经管商科城市平台院校池",
    stance: "商科证书/城市平台",
    bands: ["elite", "upper", "middle"],
    disciplines: ["02", "12"],
    profiles: ["就业导向型", "城市资源型", "专业兴趣强", "均衡探索型"],
    cities: ["上海", "武汉", "省会", "长三角"],
    keywords: ["经济", "金融", "会计", "审计", "财务管理", "国际商务", "商科", "证书"],
    examples: ["金融/经济学方向", "会计审计财务管理方向", "国际商务方向"],
    risks: ["商科更依赖城市、平台、实习和证书", "相近专业名称出口不同，需要看培养方案"],
  },
  {
    id: "teacher-stable",
    title: "师范/公费师范稳定路径院校池",
    stance: "稳定就业/协议路径",
    bands: ["upper", "middle", "foundation"],
    disciplines: ["04", "05"],
    profiles: ["稳健型", "就业导向型", "家庭预算敏感"],
    cities: ["吉林", "长春", "内蒙古", "省内", "省会"],
    keywords: ["师范", "公费师范", "教师", "教育", "吉林省师范", "长春", "内蒙古师范", "协议"],
    examples: ["吉林/长春师范院校方向", "内蒙古师范院校方向", "省属公费师范生路径"],
    risks: ["公费师范要核验协议、服务期和就业地域", "普通师范也要看学科平台和教师资格路径"],
  },
  {
    id: "medicine-police",
    title: "医学/军警强约束院校池",
    stance: "强约束/长周期",
    bands: ["elite", "upper", "middle"],
    disciplines: ["10", "03"],
    profiles: ["稳健型", "学术深造型", "就业导向型"],
    cities: ["省内", "省会"],
    keywords: ["医学", "本博连读", "军校", "警校", "体检", "体测", "政审", "规培"],
    examples: ["医学本博连读院校名单", "警校体检体测标准", "军校名单及体检标准"],
    risks: ["体检、政审、服务期和长学制是硬约束", "医学路径要看规培、医院资源和学习年限"],
  },
  {
    id: "vocational-dual",
    title: "高职双高/专升本技能路径院校池",
    stance: "职业技能/升学兜底",
    bands: ["middle", "foundation"],
    disciplines: ["08", "12"],
    profiles: ["稳健型", "就业导向型", "家庭预算敏感"],
    cities: ["省内", "省会", "区域"],
    keywords: ["专科", "高职", "职业教育", "双高", "专升本", "技能", "就业"],
    examples: ["高职专科方向", "双高技能路径", "专升本备选路径"],
    risks: ["高职专科应按职业路径评价，不要套本科排名逻辑", "需要核验升学通道和区域产业"],
  },
  {
    id: "regional-safe",
    title: "省内/区域稳妥院校池",
    stance: "稳妥保底/家庭可执行",
    bands: ["upper", "middle", "foundation"],
    disciplines: ["01", "02", "03", "04", "05", "07", "08", "10", "12"],
    profiles: ["稳健型", "家庭预算敏感", "均衡探索型"],
    cities: ["省内", "省会", "昆明", "吉林", "长春", "内蒙古", "武汉"],
    keywords: ["省", "区域", "昆明市的高校", "吉林", "长春", "内蒙古", "稳", "保", "兜底"],
    examples: ["省内稳妥高校方向", "昆明/吉林/长春/内蒙古区域材料", "可执行保底方案"],
    risks: ["保底项也必须是孩子愿意就读的学校和专业", "要核验调剂后最低可接受专业"],
  },
];

const SCHOOL_RECOMMENDATIONS = {
  "elite-platform": [
    { name: "中山大学", tags: ["985", "综合平台"], focus: "高平台综合院校，需核验目标专业最低位次。" },
    { name: "武汉大学", tags: ["985", "武汉"], focus: "高平台与城市资源并重，需看专业组和调剂范围。" },
    { name: "南开大学", tags: ["985", "综合平台"], focus: "适合高位段上探，先查同省近三年位次。" },
    { name: "厦门大学", tags: ["985", "综合平台"], focus: "适合平台优先型，注意专业冷热和校区。" },
  ],
  "shanghai-city": [
    { name: "上海交通大学", tags: ["上海", "高平台"], focus: "工科/医学/综合平台强，通常需高位次核验。" },
    { name: "同济大学", tags: ["上海", "工学"], focus: "工科和城市资源突出，需核验专业组分数。" },
    { name: "华东理工大学", tags: ["上海", "工学"], focus: "化工材料等方向可重点核验专业录取分。" },
    { name: "上海大学", tags: ["上海", "综合"], focus: "城市资源强，适合作为稳妥或备选核验。" },
  ],
  "wuhan-city": [
    { name: "华中科技大学", tags: ["武汉", "工学"], focus: "工科/医学强平台，需用专业组投档和专业分核验。" },
    { name: "武汉大学", tags: ["武汉", "综合"], focus: "综合平台强，适合高分段核验。" },
    { name: "武汉理工大学", tags: ["武汉", "工学"], focus: "工科产业方向明确，适合工程实践型学生核验。" },
    { name: "湖北大学", tags: ["武汉", "区域稳妥"], focus: "区域稳妥方向，需核验专业和分差。" },
  ],
  "hongkong-macao": [
    { name: "香港大学", tags: ["港澳", "高成本"], focus: "高平台国际化路径，费用和申请规则先核验。" },
    { name: "香港中文大学", tags: ["港澳", "计划内/申请"], focus: "需区分计划内招生和申请路径。" },
    { name: "香港科技大学", tags: ["港澳", "理工商"], focus: "理工商方向突出，先核验申请、语言和预算。" },
    { name: "澳门大学", tags: ["港澳", "预算核验"], focus: "可作为港澳路径备选，需核验费用和专业。" },
  ],
  "science-research": [
    { name: "中国科学技术大学", tags: ["理学", "高平台"], focus: "基础学科和深造导向强，需高位次核验。" },
    { name: "吉林大学", tags: ["理学", "综合"], focus: "法学/历史/基础学科资料中多次出现，需看目标专业分。" },
    { name: "云南大学", tags: ["区域", "理学"], focus: "区域与生态/地学等方向可核验。" },
  ],
  "engineering-industry": [
    { name: "上海交通大学", tags: ["工学", "上海"], focus: "高平台工程方向，先查专业组和专业最低位次。" },
    { name: "华中科技大学", tags: ["工学", "武汉"], focus: "工程和产业资源强，适合上探核验。" },
    { name: "武汉理工大学", tags: ["工学", "武汉"], focus: "工程实践和区域产业匹配度高。" },
    { name: "中北大学", tags: ["工学", "兵工特色"], focus: "资料中作为校名误判案例，适合核验特色专业。" },
  ],
  "business-city": [
    { name: "上海财经大学", tags: ["商科", "上海"], focus: "财经平台强，需核验专业录取分和城市成本。" },
    { name: "中南财经政法大学", tags: ["商科", "武汉"], focus: "经法商交叉平台，适合经管法方向核验。" },
    { name: "上海对外经贸大学", tags: ["商科", "上海"], focus: "外贸/商务方向城市匹配，需核验分数与语种要求。" },
  ],
  "teacher-stable": [
    { name: "华东师范大学", tags: ["师范", "985"], focus: "高平台师范，需核验专业分和公费/普通路径。" },
    { name: "东北师范大学", tags: ["师范", "211"], focus: "师范强校，适合稳定路径核验。" },
    { name: "吉林师范类院校", tags: ["区域师范"], focus: "资料有吉林/长春师范院校方向，适合省内就业核验。" },
    { name: "内蒙古师范大学", tags: ["区域师范"], focus: "区域师范方向，需看省份计划和服务地域。" },
  ],
  "medicine-police": [
    { name: "北京大学医学部", tags: ["医学", "高平台"], focus: "医学高平台，需极高位次和长学制核验。" },
    { name: "上海交通大学医学院", tags: ["医学", "上海"], focus: "临床医学强，需核验专业最低位次和学制。" },
    { name: "军校名单院校", tags: ["军校", "体检政审"], focus: "先核验体检、政审、服务期和招生计划。" },
    { name: "警校名单院校", tags: ["警校", "体测"], focus: "先核验体测、体检、政审和省份计划。" },
  ],
  "vocational-dual": [
    { name: "双高计划高职院校", tags: ["高职", "双高"], focus: "以专业群、区域产业和专升本通道核验。" },
    { name: "省内优质高职院校", tags: ["省内", "就业"], focus: "适合预算敏感和就业导向，需查专业就业和升学。" },
    { name: "职业教育本科/专升本路径", tags: ["升学"], focus: "作为兜底或技能路径继续核验。" },
  ],
  "regional-safe": [
    { name: "省内公办本科院校", tags: ["省内", "稳妥"], focus: "保底要先确认孩子愿读专业和调剂范围。" },
    { name: "昆明市高校方向", tags: ["昆明", "区域"], focus: "资料有昆明高校介绍，适合区域机会核验。" },
    { name: "湖北大学", tags: ["武汉", "区域"], focus: "资料有录取案例，需用本省分数表核验。" },
    { name: "云南大学", tags: ["区域", "综合"], focus: "区域综合平台，需看省份计划和专业分。" },
  ],
};

function fmtNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(value ?? 0);
}

function fmtBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function statusLabel(status) {
  const map = {
    "text-extracted": "正文已抽取",
    "ocr-extracted": "OCR已抽取",
    "asr-transcribed": "ASR已转写",
    "asr-partial-transcribed": "ASR部分转写",
    "audio-indexed-needs-transcript": "音频待转写",
    "image-indexed-needs-chinese-ocr": "图片待OCR",
    "pdf-indexed-needs-chinese-ocr": "PDF待OCR",
    "indexed-only": "仅索引",
    "text-empty-or-unreadable": "文本不足",
    "fallback-strings": "兜底抽取",
    "extract-error": "抽取失败",
  };
  return map[status] || status || "未知";
}

function sourceById(id) {
  return state.data.sourceFiles.find((item) => item.id === id);
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function parseList(value) {
  return String(value ?? "")
    .split(/[\s,，、;；/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isSelected(value, current) {
  return value === current ? "selected" : "";
}

function getProfileValue(profile, key) {
  return profile?.[key] ?? DEFAULT_PROFILE[key] ?? "";
}

function rankUsageOptionValue(option) {
  return `${option.usage}|${option.category || ""}|${option.level || ""}`;
}

function rankUsageProfileValue(profile) {
  const usage = profile?.rankUsage || "ordinary";
  const category = profile?.rankCategory || "";
  const level = profile?.rankLevelUsage || "";
  return `${usage}|${category}|${level}`;
}

const SPECIAL_RANK_USAGE_ORDER = {
  ordinary: 0,
  sports: 1,
  art: 2,
  "art-professional": 3,
  "art-cultural": 4,
  spring: 5,
};

function availableRankUsageOptions() {
  const options = new Map();
  const add = (option) => {
    const key = rankUsageOptionValue(option);
    if (!options.has(key)) options.set(key, option);
  };
  add({ usage: "ordinary", category: "", level: "", label: "普通类文化成绩" });
  for (const record of rankConversionRecords()) {
    if (!Object.prototype.hasOwnProperty.call(SPECIAL_RANK_USAGE_ORDER, record.rankUsage)) continue;
    if (record.rankUsage === "ordinary") continue;
    const category = record.rankCategory || (record.rankUsage === "sports" ? "体育类" : "");
    if (!category) continue;
    const level = record.rankLevelUsage || "";
    const levelText = level ? `（${RANK_LEVEL_LABELS[level] || record.rankLevelUsageLabel || level}）` : "";
    const baseLabel = record.rankUsageLabel
      ? String(record.rankUsageLabel).replace(/（(本科|专科)加分）$/, "")
      : `${category}成绩`;
    add({
      usage: record.rankUsage,
      category,
      level,
      label: `${baseLabel}${levelText}`,
    });
  }
  return [...options.values()].sort((a, b) => {
    return (SPECIAL_RANK_USAGE_ORDER[a.usage] ?? 9) - (SPECIAL_RANK_USAGE_ORDER[b.usage] ?? 9) ||
      String(a.category || "").localeCompare(String(b.category || ""), "zh-Hans-CN") ||
      String(a.level || "").localeCompare(String(b.level || ""), "zh-Hans-CN");
  });
}

function sourceSearchText(source) {
  return [
    source.title,
    source.relativePath,
    source.excerpt,
    source.domains.map((d) => d.label).join(" "),
    source.disciplines.map((d) => `${d.code} ${d.name}`).join(" "),
  ].join(" ").toLowerCase();
}

function sourceScore(source, keywords) {
  const title = normalizeText(source.title);
  const path = normalizeText(source.relativePath);
  const excerpt = normalizeText(source.excerpt);
  const labels = normalizeText([
    source.domains.map((d) => d.label).join(" "),
    source.disciplines.map((d) => `${d.code} ${d.name}`).join(" "),
  ].join(" "));
  let score = 0;
  const hits = [];
  for (const keyword of keywords) {
    const key = normalizeText(keyword);
    if (!key) continue;
    let matched = false;
    if (title.includes(key)) {
      score += 5;
      matched = true;
    }
    if (path.includes(key)) {
      score += 3;
      matched = true;
    }
    if (labels.includes(key)) {
      score += 3;
      matched = true;
    }
    if (excerpt.includes(key)) {
      score += 1;
      matched = true;
    }
    if (matched) hits.push(keyword);
  }
  return { score, hits };
}

function findEvidence(keywords, limit = 7) {
  return state.data.sourceFiles
    .map((source) => {
      const scored = sourceScore(source, keywords);
      return { source, score: scored.score, hits: scored.hits };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.source.textLength - a.source.textLength)
    .slice(0, limit);
}

function classifyScoreBand(score, rank) {
  const numericScore = Number(score) || 0;
  const numericRank = Number(rank) || 0;
  if (numericScore > 0 && numericScore < 300) {
    return { id: "foundation", label: "专科/技能段", order: 1, strategy: "优先看公办高职、双高专业群、专升本通道、区域产业和家庭可执行性。" };
  }
  if ((numericRank > 0 && numericRank <= 5000) || numericScore >= 650) {
    return { id: "elite", label: "高位段", order: 4, strategy: "优先看高平台、强学科和上限机会，同时保留稳妥专业兜底。" };
  }
  if ((numericRank > 0 && numericRank <= 20000) || numericScore >= 600) {
    return { id: "upper", label: "上位段", order: 3, strategy: "适合在高平台、强区域城市和专业质量之间做平衡。" };
  }
  if ((numericRank > 0 && numericRank <= 60000) || numericScore >= 540) {
    return { id: "middle", label: "中位段", order: 2, strategy: "优先看专业适配、城市资源、稳妥录取边界和可接受调剂。" };
  }
  return { id: "foundation", label: "基础段", order: 1, strategy: "本科兜底、高职双高、专升本和技能就业路径要同步比较。" };
}

function bandFit(candidate, band) {
  if (candidate.bands.includes(band.id)) return 92;
  const orderById = { foundation: 1, middle: 2, upper: 3, elite: 4 };
  const closest = Math.max(...candidate.bands.map((id) => orderById[id] || 0));
  const distance = Math.abs((orderById[band.id] || 0) - closest);
  return clamp(74 - distance * 18, 22, 78);
}

function hasStructuredAdmissionScores() {
  return (state.data?.admissionScoreLayer?.structuredRecords || 0) > 0;
}

function admissionRecords() {
  return state.data?.admissionScoreLayer?.records || [];
}

function rankConversionRecords() {
  return state.data?.admissionScoreLayer?.rankConversions || [];
}

function isControlLineRecord(record) {
  return record?.dataType === "control-line" || /control-line|控制线/.test(String(record?.sourceQuality || ""));
}

function isPlanRecord(record) {
  return record?.dataType === "admission-plan" || record?.planOnly === true;
}

function normalizeSubject(value) {
  const text = normalizeText(value);
  if (!text || text === "不确定") return "";
  if (/物理|理科|理工/.test(text)) return "物理";
  if (/历史|文科|文史/.test(text)) return "历史";
  return text;
}

function normalizeProvince(value) {
  const text = String(value ?? "").trim().replace(/省|市|自治区|壮族|回族|维吾尔/g, "");
  return ALL_PROVINCES.find((province) => text.includes(province) || province.includes(text)) || text;
}

function subjectMatchesRecord(record, profile) {
  const profileSubject = normalizeSubject(profile.subject);
  const recordSubject = normalizeSubject(record.subjectType);
  if (!profileSubject || !recordSubject) return true;
  if (profileSubject === "综合") return true;
  if (recordSubject === "综合") return true;
  return recordSubject.includes(profileSubject) || profileSubject.includes(recordSubject);
}

function provinceMatchesRecord(record, profile) {
  const profileProvince = normalizeProvince(profile.province);
  const recordProvince = normalizeProvince(record.province);
  if (!profileProvince || !recordProvince) return true;
  return profileProvince === recordProvince;
}

function profileAdmissionRecords(profile) {
  return admissionRecords().filter((record) =>
    !isControlLineRecord(record) &&
    !isPlanRecord(record) &&
    !recordConflictsWithRedLines(record, profile) &&
    provinceMatchesRecord(record, profile) &&
    subjectMatchesRecord(record, profile)
  );
}

function profilePlanRecords(profile) {
  return admissionRecords().filter((record) =>
    isPlanRecord(record) &&
    !recordConflictsWithRedLines(record, profile) &&
    provinceMatchesRecord(record, profile) &&
    subjectMatchesRecord(record, profile)
  );
}

function provinceReadinessForProfile(profile) {
  const province = normalizeProvince(profile.province);
  if (!province) return null;
  const layer = state.data?.admissionScoreLayer || {};
  return ((layer.provinceReadiness || layer.coverage?.provinceReadiness)?.rows || [])
    .find((row) => normalizeProvince(row.province) === province) || null;
}

let admissionTrendIndexCache = null;

function admissionTrendKey(record) {
  return [
    record.province || "",
    record.subjectType || "",
    record.batch || "",
    record.schoolName || "",
    record.majorName || "",
    record.majorGroup || "",
  ].join("|");
}

function admissionTrendIndex() {
  if (admissionTrendIndexCache) return admissionTrendIndexCache;
  admissionTrendIndexCache = new Map();
  for (const record of admissionRecords()) {
    if (record.dataType !== "major-admission" || !record.majorName) continue;
    const key = admissionTrendKey(record);
    if (!admissionTrendIndexCache.has(key)) admissionTrendIndexCache.set(key, []);
    admissionTrendIndexCache.get(key).push(record);
  }
  for (const records of admissionTrendIndexCache.values()) {
    records.sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0));
  }
  return admissionTrendIndexCache;
}

function trendYearsLabel(count) {
  if (count <= 2) return "近两年";
  if (count === 3) return "近三年";
  if (count === 4) return "近四年";
  return `近${count}年`;
}

function trendRecordLabel(count) {
  if (count <= 2) return "双年";
  if (count === 3) return "三年";
  if (count === 4) return "四年";
  return `${count}年`;
}

function trendForRecord(record) {
  if (record.dataType !== "major-admission" || !record.majorName) return null;
  const records = admissionTrendIndex().get(admissionTrendKey(record)) || [];
  const seriesByYear = new Map();
  for (const item of records) {
    if (item.year && !seriesByYear.has(item.year)) seriesByYear.set(item.year, item);
  }
  const series = [...seriesByYear.values()].sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0));
  if (series.length < 2) return null;
  const current = series.find((item) => item.id === record.id) || series[0];
  const previous = series.find((item) => item.year && item.year !== current.year);
  if (!previous) return null;
  const rankSeries = series.filter((item) => Number(item.minRankEnd) > 0);
  const currentRankItem = rankSeries.find((item) => item.id === current.id);
  const previousRankItem = rankSeries.find((item) => item.id !== current.id);
  if (rankSeries.length >= 2 && currentRankItem && previousRankItem) {
    const currentRank = Number(currentRankItem.minRankEnd) || 0;
    const previousRank = Number(previousRankItem.minRankEnd) || 0;
    if (currentRank && previousRank) {
      const visibleSeries = rankSeries.slice(0, 6);
      const gap = currentRank - previousRank;
      const direction = gap > 0 ? "位次放宽" : gap < 0 ? "位次收紧" : "位次持平";
      const values = visibleSeries.map((item) => Number(item.minRankEnd)).filter(Boolean);
      const label = trendYearsLabel(visibleSeries.length);
      const rangeText = visibleSeries.length >= 3
        ? `${label}位次区间${fmtNumber(Math.min(...values))}-${fmtNumber(Math.max(...values))}。`
        : "";
      const yearText = visibleSeries.map((item) => `${item.year}年${fmtNumber(Number(item.minRankEnd))}`).join("，");
      return {
        label: `${label}专业位次`,
        text: `${yearText}；${currentRankItem.year}较${previousRankItem.year}${direction}${gap ? `${fmtNumber(Math.abs(gap))}名` : ""}。${rangeText}`,
      };
    }
  }
  const scoreSeries = series.filter((item) => Number(item.minScore) > 0);
  const currentScoreItem = scoreSeries.find((item) => item.id === current.id);
  const previousScoreItem = scoreSeries.find((item) => item.id !== current.id);
  if (scoreSeries.length >= 2 && currentScoreItem && previousScoreItem) {
    const currentScore = Number(currentScoreItem.minScore) || 0;
    const previousScore = Number(previousScoreItem.minScore) || 0;
    if (currentScore && previousScore) {
      const visibleSeries = scoreSeries.slice(0, 6);
      const gap = currentScore - previousScore;
      const direction = gap > 0 ? "最低分上升" : gap < 0 ? "最低分下降" : "最低分持平";
      const values = visibleSeries.map((item) => Number(item.minScore)).filter(Boolean);
      const label = trendYearsLabel(visibleSeries.length);
      const rangeText = visibleSeries.length >= 3
        ? `${label}最低分区间${Math.min(...values)}-${Math.max(...values)}分。`
        : "";
      const yearText = visibleSeries.map((item) => `${item.year}年${Number(item.minScore)}`).join("，");
      return {
        label: `${label}专业分`,
        text: `${yearText}；${currentScoreItem.year}较${previousScoreItem.year}${direction}${gap ? `${Math.abs(gap)}分` : ""}。${rangeText}`,
      };
    }
  }
  return {
    label: `${trendYearsLabel(series.length)}专业分`,
    text: `已命中同省同科类同校同专业${trendRecordLabel(series.length)}记录，仍需复核招生计划变化。`,
  };
}

function dedupeAdmissionOptions(options) {
  const map = new Map();
  for (const option of options) {
    const key = admissionTrendKey(option.record);
    const existing = map.get(key);
    if (
      !existing ||
      (Number(option.record.year) || 0) > (Number(existing.record.year) || 0) ||
      (option.record.minRankEnd && !existing.record.minRankEnd)
    ) {
      map.set(key, option);
    }
  }
  return [...map.values()];
}

function isVocationalProfile(profile) {
  const score = Number(profile.score) || 0;
  return score > 0 && score < 300;
}

function scoreRangeForRecord(record) {
  const min = Number(record?.scoreRange?.min);
  const max = Number(record?.scoreRange?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return null;
  return { min, max };
}

function scoreCoveredByRecord(record, score) {
  const range = scoreRangeForRecord(record);
  if (range) return score >= range.min && score <= range.max;
  return Number(record.score) === score;
}

function scoreDistanceFromRecord(record, score) {
  const range = scoreRangeForRecord(record);
  if (range) {
    if (score >= range.min && score <= range.max) return 0;
    return Math.min(Math.abs(score - range.min), Math.abs(score - range.max));
  }
  return Math.abs((Number(record.score) || 0) - score);
}

function rankScoreText(record, requestedScore, covered) {
  const range = scoreRangeForRecord(record);
  if (range && covered) {
    if (range.min <= 0) return `${fmtNumber(range.max)}分及以下区间`;
    if (range.max >= 750) return `${fmtNumber(range.min)}分及以上区间`;
    return `${fmtNumber(range.min)}-${fmtNumber(range.max)}分区间`;
  }
  return covered ? `${requestedScore}分` : `最接近的${fmtNumber(record.score)}分`;
}

function recordEligibleForCandidate(record, candidate, profile) {
  const vocationalRecord = record.dataType === "vocational-admission";
  if (isVocationalProfile(profile)) {
    return vocationalRecord && ["vocational-dual", "regional-safe"].includes(candidate.id);
  }
  if (vocationalRecord) return isVocationalProfile(profile) && ["vocational-dual", "regional-safe"].includes(candidate.id);
  return true;
}

function preferredRankUsageForProfile(profile) {
  if (profile?.rankUsage && profile.rankUsage !== "ordinary") return profile.rankUsage;
  return isVocationalProfile(profile) ? "vocational" : "undergraduate";
}

function recordMatchesRankUsage(record, preferredRankUsage, rankCategory, rankLevelUsage) {
  const recordUsage = record.rankUsage || "undergraduate";
  if (preferredRankUsage === "vocational") {
    if (record.rankUsage && recordUsage !== "vocational") return false;
  } else if (recordUsage !== preferredRankUsage) {
    return false;
  }
  if (rankCategory && record.rankCategory !== rankCategory) return false;
  if (rankLevelUsage && (record.rankLevelUsage || "") !== rankLevelUsage) return false;
  if (!rankLevelUsage && Object.prototype.hasOwnProperty.call(SPECIAL_RANK_USAGE_ORDER, preferredRankUsage) && record.rankLevelUsage) return false;
  return true;
}

function estimateRankFromScore(profile) {
  const score = Number(profile.score) || 0;
  if (!score || !profile.province || !profile.subject || profile.subject === "不确定") return null;
  const pool = rankConversionRecords()
    .filter((record) =>
      provinceMatchesRecord(record, profile) &&
      subjectMatchesRecord(record, profile) &&
      Number.isFinite(Number(record.score)) &&
      Number.isFinite(Number(record.rankEnd))
    );
  if (!pool.length) return null;
  const latestYear = Math.max(...pool.map((record) => Number(record.year) || 0));
  const latestPoolRaw = pool.filter((record) => Number(record.year) === latestYear);
  const preferredRankUsage = preferredRankUsageForProfile(profile);
  const latestPool = latestPoolRaw.filter((record) => recordMatchesRankUsage(record, preferredRankUsage, profile.rankCategory || "", profile.rankLevelUsage || ""));
  const activeLatestPool = latestPool;
  if (!activeLatestPool.length) return null;
  const exact = activeLatestPool.find((record) => scoreCoveredByRecord(record, score));
  const coverageBounds = activeLatestPool.reduce((bounds, record) => {
    const range = scoreRangeForRecord(record);
    const min = range ? range.min : Number(record.score);
    const max = range ? range.max : Number(record.score);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return bounds;
    return {
      min: Math.min(bounds.min, min),
      max: Math.max(bounds.max, max),
    };
  }, { min: Infinity, max: -Infinity });
  if (!exact && (score < coverageBounds.min || score > coverageBounds.max)) return null;
  const nearest = exact || [...activeLatestPool].sort((a, b) =>
    scoreDistanceFromRecord(a, score) - scoreDistanceFromRecord(b, score) ||
    (Number(b.score) || 0) - (Number(a.score) || 0)
  )[0];
  if (!nearest) return null;
  const rank = Number(nearest.rankEnd) || 0;
  if (!rank) return null;
  const source = (state.data?.admissionScoreLayer?.sourceNotes || []).find((item) => item.id === nearest.sourceId);
  const province = nearest.province || profile.province;
  const subjectType = nearest.subjectType || profile.subject;
  const sameScoreCount = Number(nearest.sameRankScore) || 0;
  const matchedRange = Boolean(exact && scoreRangeForRecord(nearest) && Number(nearest.score) !== score);
  const scoreText = rankScoreText(nearest, score, Boolean(exact));
  const precisionText = exact ? (matchedRange ? "，为官方区间记录" : "") : "，不是精确同分位次";
  const sameScoreText = sameScoreCount ? `，${matchedRange ? "同区间" : "同分"}${fmtNumber(sameScoreCount)}人` : "";
  const rankUsageText = nearest.rankUsageLabel ? `（${nearest.rankUsageLabel}口径）` : "";
  return {
    rank,
    rankStart: Number(nearest.rankStart) || rank,
    rankEnd: rank,
    score: Number(nearest.score) || score,
    year: latestYear,
    province,
    subjectType,
    exact: Boolean(exact),
    sourceTitle: source?.title || "一分一段表",
    sourceUrl: source?.url || "",
    text: `未手填位次，已按${latestYear}年${province}${subjectType}${rankUsageText}一分一段表${scoreText}估算位次约${fmtNumber(rank)}名${sameScoreText}${precisionText}。`,
  };
}

function admissionScoreStatus() {
  const layer = state.data?.admissionScoreLayer || {};
  return {
    available: hasStructuredAdmissionScores(),
    label: layer.statusLabel || "未接入结构化院校/专业录取分表",
    reason: layer.downgradeReason || "缺少结构化录取分数据，当前推荐只作为候选核验。",
  };
}

function profileFromForm() {
  const rankUsageParts = ($("#rankUsageInput")?.value || "ordinary||").split("|");
  const profile = {
    childType: $("#childType").value,
    score: $("#scoreInput").value.trim(),
    rank: $("#rankInput").value.trim(),
    rankInput: $("#rankInput").value.trim(),
    province: $("#provinceInput").value.trim(),
    subject: $("#subjectInput").value,
    rankUsage: rankUsageParts[0] === "ordinary" ? "" : rankUsageParts[0],
    rankCategory: rankUsageParts[1] || "",
    rankLevelUsage: rankUsageParts[2] || "",
    disciplineFocus: $("#disciplineFocus").value,
    interest: $("#interestInput").value.trim(),
    cities: $("#cityInput").value.trim(),
    abilityProfile: $("#abilityProfileInput").value.trim(),
    redLines: $("#redLineInput").value.trim(),
    budget: $("#budgetInput").value,
    strategy: $("#strategyInput").value,
  };
  if (!profile.rank) {
    const estimate = estimateRankFromScore(profile);
    if (estimate) {
      profile.rank = String(estimate.rank);
      profile.estimatedRank = estimate.rank;
      profile.rankEstimate = estimate;
      profile.rankEstimateText = estimate.text;
      profile.rankEstimateSource = estimate.sourceTitle;
      profile.rankEstimateUrl = estimate.sourceUrl;
    }
  }
  return profile;
}

function hasTextHit(text, keywords) {
  const normalized = normalizeText(text);
  return keywords.some((keyword) => normalized.includes(normalizeText(keyword)));
}

function recordSearchText(record) {
  return [
    record.schoolName,
    record.schoolCode,
    record.majorName,
    record.majorCode,
    record.majorGroup,
    record.batch,
    record.city,
    record.dataType,
    (record.schoolTags || []).join(" "),
    (record.disciplineCodes || []).join(" "),
    (record.cautions || []).join(" "),
    record.planCorrectionNote,
    record.planRestrictionText,
  ].join(" ");
}

function recordConflictsWithRedLines(record, profile) {
  const redLines = normalizeText(profile?.redLines);
  if (!redLines) return false;
  const recordText = normalizeText(recordSearchText(record));
  const tuitionText = String(record?.tuition ?? "").replace(/[^\d.]/g, "");
  const tuition = tuitionText ? Number(tuitionText) : NaN;
  const isCooperative = /中外合作|合作办学/.test(recordText);
  const isHighTuition = Number.isFinite(tuition) && tuition >= HIGH_TUITION_THRESHOLD;
  const isHighCostCooperativeRisk = isCooperative && (!Number.isFinite(tuition) || isHighTuition);
  const rejectsHighCostCooperative = /(不接受|拒绝|不要|排除)[^，,；;。]*高学费[^，,；;。]*中外合作|(不接受|拒绝|不要|排除)[^，,；;。]*中外合作[^，,；;。]*高学费/.test(redLines);
  const rejectsAnyCooperative = /不接受中外合作|拒绝中外合作|不要中外合作|排除中外合作/.test(redLines);
  const rejectsAnyHighTuition = /不接受高学费(?![^，,；;。]*中外合作)|拒绝高学费(?![^，,；;。]*中外合作)|不要高学费(?![^，,；;。]*中外合作)|排除高学费(?![^，,；;。]*中外合作)/.test(redLines);
  return (rejectsHighCostCooperative && isHighCostCooperativeRisk)
    || (rejectsAnyCooperative && isCooperative)
    || (rejectsAnyHighTuition && isHighTuition);
}

function candidateMatchesAdmissionRecord(candidate, record, profile) {
  const text = normalizeText(recordSearchText(record));
  const codes = record.disciplineCodes || [];
  if (profile.disciplineFocus && codes.includes(profile.disciplineFocus)) return true;
  if (candidate.disciplines.some((code) => codes.includes(code))) return true;
  if (candidate.keywords.some((keyword) => text.includes(normalizeText(keyword)))) return true;
  if (candidate.cities.some((city) => text.includes(normalizeText(city)))) return true;
  if (candidate.id === "regional-safe" && record.province && record.city) return true;
  return false;
}

function isVocationalPlanRecord(record) {
  return /专科|高职|职业|对口/.test(`${record.batch || ""} ${record.sourceSubjectRaw || ""} ${record.schoolTags?.join(" ") || ""}`);
}

function planRecordMatchesBand(record, candidate, profile, band) {
  const vocationalPlan = isVocationalPlanRecord(record);
  if (candidate.id === "vocational-dual") return vocationalPlan;
  if (isVocationalProfile(profile)) return vocationalPlan || candidate.id === "regional-safe";
  if (vocationalPlan && band.id !== "foundation") return false;
  return true;
}

function planRoleForRecord(record) {
  const batch = String(record.batch || "");
  if (/专科|高职|对口/.test(batch)) return "专科计划";
  if (/本科一批|国家专项|高校专项|提前录取本科一批/.test(batch)) return "本科计划";
  if (/本科二批|预科/.test(batch)) return "本科兜底";
  return "计划核验";
}

function buildPlanOptions(candidate, profile, band) {
  const interestWords = parseList(`${profile.interest} ${profile.abilityProfile}`);
  const cityPrefs = parseList(profile.cities);
  const records = profilePlanRecords(profile)
    .filter((record) => planRecordMatchesBand(record, candidate, profile, band))
    .filter((record) => candidateMatchesAdmissionRecord(candidate, record, profile) || candidate.id === "regional-safe")
    .map((record) => {
      const planCount = Number(record.planCount) || 0;
      let optionScore = 42 + Math.min(planCount, 12);
      optionScore += majorInterestScore(record, profile);
      if (candidate.disciplines.some((code) => (record.disciplineCodes || []).includes(code))) optionScore += 18;
      if (cityPrefs.length && hasTextHit(`${record.city || ""} ${record.schoolName || ""}`, cityPrefs)) optionScore += 10;
      if (interestWords.length && hasTextHit(recordSearchText(record), interestWords)) optionScore += 10;
      const tags = [
        record.city,
        record.batch,
        record.planCorrectionNote ? "官方计划更正" : "",
        planCount ? `计划${fmtNumber(planCount)}名` : "",
        record.electiveRequirement ? `选科${record.electiveRequirement}` : "",
        record.tuition ? `学费${record.tuition}` : "",
        record.majorGroup || "",
      ].filter(Boolean);
      const yearText = record.year ? `${record.year}年` : "当年";
      const planText = planCount ? `计划${fmtNumber(planCount)}名` : "计划数需复核";
      const correctionText = [record.planCorrectionNote, record.planRestrictionText].filter(Boolean).join("；");
      return {
        name: record.schoolName,
        tags,
        focus: `${record.majorName || "招生专业"}：${yearText}${record.province || profile.province}${record.subjectType || profile.subject}${record.batch || ""}${planText}；该项只说明官方招生计划和可报专业池，不能判断录取概率。${correctionText ? `；${correctionText}` : ""}`,
        role: planRoleForRecord(record),
        optionScore,
        admissionFit: { zone: "计划核验", score: 46, text: "计划层候选，不含录取最低分或位次" },
        scoreStatus: "官方计划层：需等投档/录取分闭合",
        record,
      };
    })
    .sort((a, b) => b.optionScore - a.optionScore || (Number(b.record.planCount) || 0) - (Number(a.record.planCount) || 0));
  return dedupeAdmissionOptions(records).slice(0, 3);
}

function majorInterestScore(record, profile) {
  const text = normalizeText(recordSearchText(record));
  const interestWords = parseList(`${profile.interest} ${profile.abilityProfile}`);
  let score = 0;
  for (const word of interestWords) {
    if (text.includes(normalizeText(word))) score += 8;
  }
  if ((record.disciplineCodes || []).includes(profile.disciplineFocus)) score += 14;
  if (/语文|英语|表达|内容|媒体|数字媒体|虚拟现实|VR/i.test(profile.abilityProfile) && /虚拟现实|数字媒体|软件|数据|信息/.test(record.majorName || "")) score += 10;
  if (/数学102|物理77|数学中等|物理中等/.test(profile.abilityProfile) && /数学与应用数学|信息与计算科学|人工智能|电子信息|电气/.test(record.majorName || "")) score -= 8;
  if (/化学|生物|物化生|生物88|化学82/.test(profile.abilityProfile) && /智能医学|药学|医学检验|生物|制药|食品/.test(record.majorName || "")) score += 8;
  return score;
}

function admissionFit(record, profile) {
  const rank = Number(profile.rank) || 0;
  const score = Number(profile.score) || 0;
  const minRankEnd = Number(record.minRankEnd) || 0;
  const minScore = Number(record.minScore) || 0;
  if (rank > 0 && minRankEnd > 0) {
    const gap = rank - minRankEnd;
    if (gap <= -5000) return { zone: "稳", score: 94, text: `位次比近年最低位次靠前${fmtNumber(Math.abs(gap))}名` };
    if (gap <= -1500) return { zone: "稳妥", score: 86, text: `位次比近年最低位次靠前${fmtNumber(Math.abs(gap))}名` };
    if (gap <= 600) return { zone: "临界稳", score: 76, text: `位次接近近年最低位次，差距${fmtNumber(Math.abs(gap))}名以内` };
    if (gap <= 3500) return { zone: "冲", score: 62, text: `位次落后近年最低位次约${fmtNumber(gap)}名` };
    return { zone: "高冲", score: 42, text: `位次落后近年最低位次约${fmtNumber(gap)}名` };
  }
  if (score > 0 && minScore > 0) {
    const gap = score - minScore;
    if (gap >= 18) return { zone: "分数稳", score: 84, text: `分数高出近年最低分${gap}分，缺位次需复核` };
    if (gap >= 8) return { zone: "分数稳妥", score: 76, text: `分数高出近年最低分${gap}分，缺位次需复核` };
    if (gap >= 0) return { zone: "分数临界", score: 66, text: `分数高出近年最低分${gap}分，缺位次需复核` };
    if (gap >= -8) return { zone: "分数冲", score: 52, text: `分数低于近年最低分${Math.abs(gap)}分，缺位次需复核` };
    return { zone: "分数高冲", score: 36, text: `分数低于近年最低分${Math.abs(gap)}分，缺位次需复核` };
  }
  return { zone: "待核验", score: 46, text: "缺少最低位次/最低分，不能判断可达性" };
}

function isLimitedAdmissionRecord(record) {
  const quality = String(record?.sourceQuality || "");
  return /rank-only|regular2/.test(quality);
}

function admissionRecordLimitWarning(record) {
  if (!isLimitedAdmissionRecord(record)) return "";
  if (String(record?.sourceQuality || "").includes("regular2")) {
    return "该来源是普通类常规批第2次志愿/剩余计划投档位次，不等同于首次投档或最终录取分。";
  }
  return "该来源只含最低位次，不含最低分，需结合一分一段和当年计划复核。";
}

function isProfessionalFilingRecord(record) {
  return /major-filing|ordinary-second-major-filing/.test(String(record?.sourceQuality || ""));
}

function buildAdmissionOptions(candidate, profile) {
  const records = profileAdmissionRecords(profile)
    .filter((record) => recordEligibleForCandidate(record, candidate, profile))
    .filter((record) => candidateMatchesAdmissionRecord(candidate, record, profile))
    .map((record) => {
      const fit = admissionFit(record, profile);
      const trend = trendForRecord(record);
      const optionScore = fit.score + majorInterestScore(record, profile) + (trend ? 5 : 0);
      const tags = [
        record.city,
        ...(record.schoolTags || []),
        record.minScore ? `最低分${record.minScore}` : "",
        record.rankRangeText ? `位次${record.rankRangeText}` : "",
        trend?.label || "",
        record.majorGroup || "",
      ].filter(Boolean);
      return {
        name: record.schoolName,
        tags,
        focus: `${record.majorName}：${fit.text}。${trend ? `${trend.text}` : ""}${admissionRecordLimitWarning(record) || (record.cautions || [])[0] || "需复核招生计划、专业组和章程。"}`,
        role: fit.zone,
        optionScore,
        admissionFit: fit,
        scoreStatus: record.dataType === "vocational-admission"
          ? record.minRankEnd
            ? isLimitedAdmissionRecord(record) ? "已接入高职专科第2次志愿最低位次（无最低分）" : "已接入高职专科投档线和最低位次"
            : String(record.sourceQuality || "").includes("admission") ? "已接入高职专科录取最低分，位次待补" : "已接入高职专科投档线，位次待补"
          : String(record.sourceQuality || "").includes("filing")
            ? record.minRankEnd
              ? isProfessionalFilingRecord(record) ? "已接入普通类专业投档线和最低位次" : "已接入本科投档线和最低位次"
              : "已接入本科投档线，位次待补"
            : record.minRankEnd ? "已接入专业最低位次" : "已接入专业最低分，位次待补",
        record,
      };
    })
    .sort((a, b) => b.optionScore - a.optionScore || (b.record.minScore || 0) - (a.record.minScore || 0));
  return dedupeAdmissionOptions(records).slice(0, 5);
}

function buildSchoolOptions(candidate, profile, band) {
  const scoreStatus = admissionScoreStatus();
  const profileRecordCount = profileAdmissionRecords(profile).length;
  const provinceReadiness = provinceReadinessForProfile(profile);
  const cityPrefs = parseList(profile.cities);
  const interestWords = parseList(profile.interest);
  const vocationalMode = isVocationalProfile(profile);
  const nonVocationalLowScoreCandidate = vocationalMode && !["vocational-dual", "regional-safe"].includes(candidate.id);
  const source = SCHOOL_RECOMMENDATIONS[candidate.id] || [];
  const ranked = source.map((school) => {
    const text = `${school.name} ${school.tags.join(" ")} ${school.focus}`;
    let score = 50;
    if (cityPrefs.length && hasTextHit(text, cityPrefs)) score += 16;
    if (interestWords.length && hasTextHit(text, interestWords)) score += 16;
    if (candidate.disciplines.includes(profile.disciplineFocus)) score += 10;
    if (candidate.profiles.includes(profile.childType)) score += 8;
    if (band.id === "elite" && /高平台|985|211/.test(text)) score += 8;
    if (profile.budget !== "不敏感" && /高成本|港澳|中外/.test(text)) score -= 16;
    return { ...school, optionScore: score };
  }).sort((a, b) => b.optionScore - a.optionScore);
  const roles = nonVocationalLowScoreCandidate
    ? ["暂不推荐", "暂不推荐", "暂不推荐"]
    : scoreStatus.available ? ["首选", "稳妥", "备选"] : ["首选核验", "稳妥核验", "备选核验"];
  const genericScoreStatus = nonVocationalLowScoreCandidate
    ? "300分以下不使用本科专业分作为录取依据，仅保留为远期认知"
    : scoreStatus.available
    ? profileRecordCount
      ? "本方向未命中已导入专业分，需继续补该方向数据"
      : `待导入${profile.province || "该省"}${profile.subject || ""}录取分后再判定可达性`
    : "待导入院校/专业录取分后再判定可达性";
  const genericOptions = ranked.slice(0, 3).map((school, index) => ({
    ...school,
    role: roles[index] || "备选核验",
    scoreStatus: genericScoreStatus,
  }));
  const admissionOptions = buildAdmissionOptions(candidate, profile);
  const planOptions = buildPlanOptions(candidate, profile, band);
  const shouldSurfacePlans = planOptions.length && (
    !admissionOptions.length ||
    ["seed", "thin"].includes(provinceReadiness?.status) ||
    profileRecordCount < 20
  );
  const admissionLimit = shouldSurfacePlans ? 2 : 5;
  return [...admissionOptions.slice(0, admissionLimit), ...planOptions, ...genericOptions].slice(0, 5);
}

function scoreCandidate(candidate, profile, band) {
  const evidence = findEvidence(candidate.keywords);
  const scoreStatus = admissionScoreStatus();
  const profileRecords = profileAdmissionRecords(profile);
  const provinceReadiness = provinceReadinessForProfile(profile);
  const candidateAdmissionRecords = profileRecords
    .filter((record) => recordEligibleForCandidate(record, candidate, profile))
    .filter((record) => candidateMatchesAdmissionRecord(candidate, record, profile));
  const bestAdmission = candidateAdmissionRecords
    .map((record) => ({ record, fit: admissionFit(record, profile), interest: majorInterestScore(record, profile) }))
    .sort((a, b) => (b.fit.score + b.interest) - (a.fit.score + a.interest))[0];
  const limitedAdmission = bestAdmission && isLimitedAdmissionRecord(bestAdmission.record);
  const redLines = parseList(profile.redLines);
  const cityPrefs = parseList(profile.cities);
  const interestWords = parseList(profile.interest);
  const vocationalMode = isVocationalProfile(profile);
  const candidateText = normalizeText([
    candidate.title,
    candidate.stance,
    candidate.examples.join(" "),
    candidate.keywords.join(" "),
    candidate.cities.join(" "),
  ].join(" "));
  const missingInputs = [];
  if (!profile.province) missingInputs.push("省份");
  if (!profile.subject || profile.subject === "不确定") missingInputs.push("科类/选科");
  if (!profile.rank) missingInputs.push("位次");

  const redLineText = normalizeText(redLines.join(" "));
  const redLineConflict = redLines.some((item) => candidateText.includes(normalizeText(item))) ||
    candidate.keywords.some((keyword) => redLineText.includes(normalizeText(keyword))) ||
    candidate.cities.some((city) => redLineText.includes(normalizeText(city)));

  let hardFit = 66;
  if (profile.province) hardFit += 8;
  if (profile.subject && profile.subject !== "不确定") hardFit += 8;
  if (profile.rank) hardFit += 8;
  if (profile.disciplineFocus && candidate.disciplines.includes(profile.disciplineFocus)) hardFit += 10;
  if (vocationalMode && candidate.id === "vocational-dual") hardFit += 12;
  if (redLineConflict) hardFit -= 30;

  let scoreRank = bandFit(candidate, band);
  if (bestAdmission) {
    scoreRank = bestAdmission.fit.score >= 76
      ? Math.max(scoreRank, bestAdmission.fit.score)
      : Math.min(scoreRank, bestAdmission.fit.score);
  }
  else if (scoreStatus.available && profileRecords.length) scoreRank -= 6;
  if (vocationalMode && candidate.id === "vocational-dual") {
    scoreRank += bestAdmission && bestAdmission.fit.score < 62 ? 8 : 20;
  }
  if (profile.strategy === "冲刺" && candidate.stance.includes("冲刺")) scoreRank += 10;
  if (profile.strategy === "稳健" && /稳|保|兜底/.test(candidate.stance)) scoreRank += 12;
  if (profile.strategy === "均衡" && /平衡|稳妥|城市|专业/.test(candidate.stance)) scoreRank += 8;

  const interestMatched = interestWords.length && candidate.keywords.some((keyword) => hasTextHit(keyword, interestWords));
  let majorFit = 58;
  if (profile.disciplineFocus && candidate.disciplines.includes(profile.disciplineFocus)) majorFit += 28;
  if (candidate.profiles.includes(profile.childType)) majorFit += 18;
  if (interestMatched) majorFit += 14;
  if (bestAdmission) majorFit += Math.min(18, Math.max(0, bestAdmission.interest));
  if (vocationalMode && candidate.id === "vocational-dual") majorFit += 18;
  if (profile.childType === "家庭预算敏感" && candidate.highCost) majorFit -= 12;

  let cityBudget = 62;
  if (cityPrefs.length && candidate.cities.some((city) => hasTextHit(city, cityPrefs))) cityBudget += 24;
  if (!cityPrefs.length) cityBudget += 6;
  if (profile.budget === "高度敏感" && candidate.highCost) cityBudget -= 36;
  if (profile.budget === "中等敏感" && candidate.highCost) cityBudget -= 18;
  if (profile.childType === "城市资源型" && candidate.cities.length) cityBudget += 10;
  if (redLineConflict) cityBudget -= 14;

  const evidenceScore = clamp(42 + evidence.length * 8 + Math.min(candidate.keywords.length, 8) * 2);
  let riskPenalty = 0;
  if (redLineConflict) riskPenalty += 22;
  if (candidate.highCost && profile.budget !== "不敏感") riskPenalty += profile.budget === "高度敏感" ? 18 : 8;
  if (missingInputs.includes("位次")) riskPenalty += 8;
  if (missingInputs.includes("省份")) riskPenalty += 8;
  if (vocationalMode && !["vocational-dual", "regional-safe"].includes(candidate.id)) riskPenalty += 18;
  if (scoreStatus.available && !profileRecords.length) riskPenalty += 10;
  if (bestAdmission && bestAdmission.fit.score < 62) riskPenalty += 16;
  else if (bestAdmission && bestAdmission.fit.score < 76) riskPenalty += 8;
  if (provinceReadiness?.status === "usable") riskPenalty += 3;
  if (provinceReadiness?.status === "seed") riskPenalty += 7;
  if (provinceReadiness?.status === "thin") riskPenalty += 12;
  if (candidate.id === "medicine-police" && !/医学|军|警|体检|稳定|深造/.test(`${profile.interest} ${profile.redLines} ${profile.childType}`)) riskPenalty += 6;

  const total = clamp(
    hardFit * 0.35 +
    scoreRank * 0.25 +
    majorFit * 0.2 +
    cityBudget * 0.1 +
    evidenceScore * 0.1 -
    riskPenalty,
    0,
    100
  );
  const officialDataDiscount =
    4 +
    (interestWords.length && !interestMatched ? 3 : 0) +
    (!candidate.profiles.includes(profile.childType) ? 2 : 0) +
    (candidate.highCost ? 2 : 0);
  let displayTotal = clamp(total - officialDataDiscount, 0, 96);
  if (vocationalMode && !["vocational-dual", "regional-safe"].includes(candidate.id)) {
    displayTotal = Math.min(displayTotal, 48);
  }
  if (bestAdmission && bestAdmission.fit.score < 62) {
    displayTotal = Math.min(displayTotal, 68);
  } else if (bestAdmission && bestAdmission.fit.score < 76) {
    displayTotal = Math.min(displayTotal, 76);
  }

  let confidence = "C";
  let confidenceReason = "探索性建议：需要补充更多输入或官方数据后再进入正式方案。";
  if (bestAdmission?.record?.minRankEnd && !limitedAdmission && !missingInputs.length && evidence.length >= 4 && bestAdmission.fit.score >= 76 && total >= 76 && riskPenalty <= 12) {
    confidence = "A";
    confidenceReason = "输入完整且已接入结构化录取分，可进入院校/专业分数排序；最终仍需官方核验。";
  } else if (bestAdmission && !missingInputs.length && evidence.length >= 4 && bestAdmission.fit.score >= 62 && total >= 68 && riskPenalty <= 16) {
    confidence = "A-";
    confidenceReason = limitedAdmission
      ? "输入完整且命中官方投档位次，但来源是第2次志愿或 rank-only 口径，只能作为强候选核验。"
      : "输入完整且有录取分数据支持，但目标专业仍需逐项核验。";
  } else if (evidence.length >= 4 && total >= 62) {
    confidence = "B";
    confidenceReason = scoreStatus.available
      ? "本地证据可用，但存在关键输入缺口或风险项，适合作为候选继续核验。"
      : "缺少结构化院校/专业录取分，当前只能作为候选核验清单，不能判断录取概率。";
  }

  const reasons = [
    `孩子画像为${profile.childType}，当前策略为${profile.strategy}，模型按公开权重给出排序。`,
    `分数/位次进入${band.label}：${band.strategy}`,
    vocationalMode
      ? "当前分数进入专科/技能段，系统会优先比较高职专科、双高专业群、专升本和就业路径。"
      : "",
    candidate.profiles.includes(profile.childType)
      ? `该院校池适合${profile.childType}，与孩子画像匹配。`
      : `该院校池不是画像最强匹配项，但可作为对照方案。`,
    profile.disciplineFocus && candidate.disciplines.includes(profile.disciplineFocus)
      ? `匹配当前专业门类偏好：${profile.disciplineFocus}。`
      : "专业门类匹配一般，需进一步看具体专业和培养方案。",
    scoreStatus.available
      ? bestAdmission
        ? `命中结构化录取数据：${bestAdmission.record.schoolName}${bestAdmission.record.majorName ? `-${bestAdmission.record.majorName}` : ""}，${bestAdmission.fit.zone}。`
        : "本方向暂未命中当前省份/科类的结构化录取记录，仍需导入更多院校/专业分。"
      : "尚未接入结构化院校/专业录取分，分数可达性必须人工查表核验。",
    cityPrefs.length && candidate.cities.some((city) => hasTextHit(city, cityPrefs))
      ? `匹配城市偏好：${candidate.cities.filter((city) => hasTextHit(city, cityPrefs)).join("、")}。`
      : "城市偏好没有强命中，排序主要来自专业/平台/证据。",
  ].filter(Boolean);

  const warnings = [
    ...(profile.rankEstimateText ? [`${profile.rankEstimateText}正式填报前必须回省考试院原表复核。`] : []),
    ...(vocationalMode && !["vocational-dual", "regional-safe"].includes(candidate.id) ? ["当前分数段不宜只按本科平台逻辑排序，应同步核验高职专科和专升本路径。"] : []),
    ...(!scoreStatus.available ? [scoreStatus.reason] : []),
    ...(scoreStatus.available && !profileRecords.length ? [`当前本地还没有导入${profile.province || "该省"}${profile.subject || ""}结构化录取记录，结果降级为全国候选。`] : []),
    ...(scoreStatus.available && profileRecords.length && !candidateAdmissionRecords.length ? ["当前方向没有命中已导入的本省同科类分数记录，建议继续补充该方向院校数据。"] : []),
    ...(bestAdmission && bestAdmission.fit.score < 62 ? ["当前最佳命中仍属于高冲区间，不能作为稳妥志愿使用。"] : []),
    ...(limitedAdmission ? [admissionRecordLimitWarning(bestAdmission.record)] : []),
    ...(provinceReadiness && provinceReadiness.status !== "strong" ? [`${provinceReadiness.province}数据成熟度为${provinceReadiness.statusLabel}（${provinceReadiness.readinessScore}分）：${provinceReadiness.recommendationUse}`] : []),
    ...candidate.risks,
    ...missingInputs.map((item) => `缺少${item}，模型可信度自动降级。`),
  ];
  if (redLineConflict) warnings.unshift("命中不可接受项，需要人工确认是否排除。");
  if (candidate.highCost && profile.budget !== "不敏感") warnings.unshift("该路径可能触发高成本风险，预算敏感家庭需谨慎。");

  return {
    ...candidate,
    total: Math.round(displayTotal),
    parts: {
      hardFit: Math.round(clamp(hardFit)),
      scoreRank: Math.round(clamp(scoreRank)),
      majorFit: Math.round(clamp(majorFit)),
      cityBudget: Math.round(clamp(cityBudget)),
      evidence: Math.round(clamp(evidenceScore)),
      riskPenalty,
    },
    evidence,
    schoolOptions: buildSchoolOptions(candidate, profile, band),
    scoreStatus,
    confidence,
    confidenceReason,
    reasons,
    warnings: [...new Set(warnings)].slice(0, 5),
  };
}

function runRecommendation() {
  const profile = profileFromForm();
  const band = classifyScoreBand(profile.score, profile.rank);
  const results = CANDIDATE_POOLS
    .map((candidate) => scoreCandidate(candidate, profile, band))
    .sort((a, b) => b.total - a.total || b.evidence.length - a.evidence.length)
    .slice(0, 8);
  state.recommendation = { profile, band, results, generatedAt: new Date().toISOString() };
  renderRecommend();
}

function filteredSources() {
  const query = state.query.trim().toLowerCase();
  return state.data.sourceFiles.filter((source) => {
    const text = [
      source.title,
      source.relativePath,
      source.excerpt,
      source.domains.map((d) => d.label).join(" "),
      source.disciplines.map((d) => `${d.code}${d.name}`).join(" "),
    ].join(" ").toLowerCase();
    const queryOk = !query || text.includes(query);
    const disciplineOk = !state.discipline || source.disciplines.some((d) => d.code === state.discipline);
    const domainOk = !state.domain || source.domains.some((d) => d.id === state.domain);
    return queryOk && disciplineOk && domainOk;
  });
}

function renderMetric(label, value) {
  return `<div class="metric"><strong>${fmtNumber(value)}</strong><span>${esc(label)}</span></div>`;
}

function renderTags(items, css = "") {
  if (!items?.length) return "";
  return `<div class="tag-row">${items.map((item) => `<span class="tag ${css}">${esc(item)}</span>`).join("")}</div>`;
}

function sectionHead(title, text) {
  return `<div class="section-head"><div><h2>${esc(title)}</h2><p>${esc(text)}</p></div></div>`;
}

function renderOverview() {
  const data = state.data;
  const stats = data.extractionStats;
  const topDomains = Object.entries(data.domainCounts).slice(0, 8);
  const topDisciplines = Object.entries(data.disciplineCounts).slice(0, 8);
  const strategy = data.strategyFramework.map((item) => {
    const sourceTags = item.sourceIds.map((id) => sourceById(id)?.title).filter(Boolean).slice(0, 4);
    return `<article class="item-card">
      <h3>${esc(item.title)}</h3>
      <p>${esc(item.body)}</p>
      ${renderTags(sourceTags)}
    </article>`;
  }).join("");
  const insights = data.experienceInsights.map((item) => {
    const sourceTags = item.sourceIds.map((id) => sourceById(id)?.title).filter(Boolean).slice(0, 4);
    return `<article class="item-card">
      <h3>${esc(item.title)}</h3>
      <p>${esc(item.body)}</p>
      ${renderTags(sourceTags, "warn")}
    </article>`;
  }).join("");
  const blueprint = (data.recommendationBlueprint || []).map((item) => {
    const sourceTags = item.sourceIds.map((id) => sourceById(id)?.title).filter(Boolean).slice(0, 3);
    return `<article class="item-card">
      <h3>${esc(item.title)}</h3>
      <p>${esc(item.body)}</p>
      ${renderTags(sourceTags)}
    </article>`;
  }).join("");

  $("#view-overview").innerHTML = `
    ${sectionHead("总览", "把本地资料整理为规则、专业门类、特殊路径、风险、经验和推荐器骨架；每条结论都保留来源文件。")}
    <div class="metric-grid">
      ${renderMetric("资料文件", stats.totalFiles)}
      ${renderMetric("已抽取正文", stats.textExtractedFiles)}
      ${renderMetric("OCR抽取文件", stats.ocrExtractedFiles)}
      ${renderMetric("OCR抽取页数", stats.ocrExtractedPages)}
      ${renderMetric("ASR完整转写", stats.asrTranscribedFiles)}
      ${renderMetric("ASR部分转写", stats.asrPartialFiles)}
      ${renderMetric("音频待转写", stats.needsAudioTranscriptFiles)}
      ${renderMetric("中文OCR待处理", stats.needsChineseOcrFiles)}
      ${renderMetric("整合轮次", data.rounds.length)}
    </div>
    <section class="band">
      <h3>知识主线</h3>
      <div class="grid-3">${strategy}</div>
    </section>
    <section class="band">
      <h3>升级版推荐骨架</h3>
      <div class="grid-3">${blueprint}</div>
    </section>
    <section class="band">
      <h3>经验与现状</h3>
      <div class="grid-3">${insights}</div>
    </section>
    <section class="grid-2">
      <div class="band">
        <h3>主题分布</h3>
        ${topDomains.map(([name, count]) => `<p><strong>${esc(name)}</strong>：${fmtNumber(count)} 个来源命中</p>`).join("")}
      </div>
      <div class="band">
        <h3>门类分布</h3>
        ${topDisciplines.map(([name, count]) => `<p><strong>${esc(name)}</strong>：${fmtNumber(count)} 个来源命中</p>`).join("")}
      </div>
    </section>
    <section class="band">
      <h3>诚实边界</h3>
      ${data.gaps.map((gap) => `<p>${esc(gap)}</p>`).join("")}
    </section>
  `;
}

function renderDisciplines() {
  const sources = filteredSources();
  const cards = state.data.disciplines.map((discipline) => {
    const matched = sources.filter((source) => source.disciplines.some((item) => item.code === discipline.code));
    return `<article class="item-card">
      <h3>${discipline.code} ${esc(discipline.name)}</h3>
      <p>${esc(discipline.guide)}</p>
      <div class="tag-row">
        <span class="tag">${fmtNumber(matched.length)} 个匹配来源</span>
        ${discipline.keywords.slice(0, 8).map((kw) => `<span class="tag">${esc(kw)}</span>`).join("")}
      </div>
      ${matched.slice(0, 5).map((source) => `<p class="mono">${esc(source.title)}</p>`).join("")}
    </article>`;
  }).join("");

  $("#view-disciplines").innerHTML = `
    ${sectionHead("专业门类", "用中国专业门类做第一层导航，07理学、08工学等方向再挂接到来源文件和经验卡片。")}
    <div class="grid-2">${cards}</div>
  `;
}

function renderRules() {
  const checklist = state.data.riskChecklist.map((item) => `
    <article class="item-card">
      <h3>${esc(item.text)}</h3>
      ${renderTags(["填报前确认"], "risk")}
    </article>`).join("");

  const domains = state.data.domains.map((domain) => {
    const sources = state.data.sourceFiles.filter((source) => source.domains.some((item) => item.id === domain.id));
    return `<article class="item-card">
      <h3>${esc(domain.label)}</h3>
      <p>${esc(domain.keywords.join(" / "))}</p>
      <div class="tag-row"><span class="tag">${fmtNumber(sources.length)} 个来源</span></div>
    </article>`;
  }).join("");

  $("#view-rules").innerHTML = `
    ${sectionHead("规则与风险", "把高考志愿里的硬规则、软风险和特殊路径前置，先排雷，再做冲稳保。")}
    <section class="band">
      <h3>填报前检查清单</h3>
      <div class="grid-2">${checklist}</div>
    </section>
    <section class="band">
      <h3>主题模块</h3>
      <div class="grid-2">${domains}</div>
    </section>
  `;
}

function renderScorePart(label, value) {
  return `<div class="score-part"><span>${esc(label)}</span><strong>${fmtNumber(value)}</strong></div>`;
}

function renderRecommendForm(profile) {
  const disciplineOptions = state.data.disciplines.map((discipline) => (
    `<option value="${esc(discipline.code)}" ${isSelected(discipline.code, getProfileValue(profile, "disciplineFocus"))}>${esc(`${discipline.code} ${discipline.name}`)}</option>`
  )).join("");
  const rankUsageOptions = availableRankUsageOptions().map((option) => {
    const value = rankUsageOptionValue(option);
    return `<option value="${esc(value)}" ${isSelected(value, rankUsageProfileValue(profile))}>${esc(option.label)}</option>`;
  }).join("");
  const rankFieldValue = profile && Object.prototype.hasOwnProperty.call(profile, "rankInput")
    ? profile.rankInput
    : getProfileValue(profile, "rank");
  return `<form id="recommendForm" class="recommend-form">
    <label>
      <span>孩子类型</span>
      <select id="childType">
        ${CHILD_TYPES.map((item) => `<option value="${esc(item)}" ${isSelected(item, getProfileValue(profile, "childType"))}>${esc(item)}</option>`).join("")}
      </select>
    </label>
    <label>
      <span>分数</span>
      <input id="scoreInput" type="number" min="0" max="750" value="${esc(getProfileValue(profile, "score"))}" />
    </label>
    <label>
      <span>位次</span>
      <input id="rankInput" type="number" min="1" value="${esc(rankFieldValue)}" />
    </label>
    <label>
      <span>省份</span>
      <input id="provinceInput" type="text" list="provinceList" value="${esc(getProfileValue(profile, "province"))}" placeholder="例如：广东、山东、河南" />
      <datalist id="provinceList">
        ${ALL_PROVINCES.map((item) => `<option value="${esc(item)}"></option>`).join("")}
      </datalist>
    </label>
    <label>
      <span>科类/选科</span>
      <select id="subjectInput">
        ${SUBJECT_TYPES.map((item) => `<option value="${esc(item)}" ${isSelected(item, getProfileValue(profile, "subject"))}>${esc(item)}</option>`).join("")}
      </select>
    </label>
    <label class="wide">
      <span>成绩口径</span>
      <select id="rankUsageInput">${rankUsageOptions}</select>
    </label>
    <label>
      <span>专业门类偏好</span>
      <select id="disciplineFocus">${disciplineOptions}</select>
    </label>
    <label>
      <span>兴趣关键词</span>
      <input id="interestInput" type="text" value="${esc(getProfileValue(profile, "interest"))}" placeholder="计算机、心理学、师范、金融..." />
    </label>
    <label>
      <span>城市偏好</span>
      <input id="cityInput" type="text" value="${esc(getProfileValue(profile, "cities"))}" placeholder="上海 武汉 省内 港澳..." />
    </label>
    <label class="wide">
      <span>学科画像/单科分</span>
      <textarea id="abilityProfileInput" rows="3" placeholder="例如：语文120 英语124 数学102 物理77 化学82 生物88；表达强，数学中等，想做技术但不想纯理论。">${esc(getProfileValue(profile, "abilityProfile"))}</textarea>
    </label>
    <label>
      <span>预算敏感度</span>
      <select id="budgetInput">
        ${BUDGET_LEVELS.map((item) => `<option value="${esc(item)}" ${isSelected(item, getProfileValue(profile, "budget"))}>${esc(item)}</option>`).join("")}
      </select>
    </label>
    <label>
      <span>策略</span>
      <select id="strategyInput">
        ${STRATEGIES.map((item) => `<option value="${esc(item)}" ${isSelected(item, getProfileValue(profile, "strategy"))}>${esc(item)}</option>`).join("")}
      </select>
    </label>
    <label class="wide">
      <span>不可接受项/红线</span>
      <textarea id="redLineInput" rows="3" placeholder="例如：不接受高学费、不接受远离省内、不接受调剂到冷门专业">${esc(getProfileValue(profile, "redLines"))}</textarea>
    </label>
    <div class="form-actions">
      <button class="primary-action" type="submit">生成推荐</button>
      <button class="ghost-action" id="resetRecommend" type="button">恢复示例</button>
    </div>
  </form>`;
}

function renderRankEstimateNotice(profile) {
  if (!profile?.rankEstimateText) return "";
  const sourceLink = profile.rankEstimateUrl
    ? `<a href="${esc(profile.rankEstimateUrl)}" target="_blank" rel="noreferrer">${esc(profile.rankEstimateSource || "来源")}</a>`
    : `<span>${esc(profile.rankEstimateSource || "一分一段来源")}</span>`;
  return `<div class="rank-estimate-note">
    <strong>位次估算</strong>
    <p>${esc(profile.rankEstimateText)} ${sourceLink}；正式填报前必须回省考试院原表复核。</p>
  </div>`;
}

function renderRecommendationResults() {
  const rec = state.recommendation;
  if (!rec) {
    return `<div class="empty-state">
      <h2>输入孩子画像和分数后生成推荐</h2>
      <p>系统会输出候选院校池、模型分、推荐理由、风险提示、来源证据和官方复核清单。</p>
    </div>`;
  }

  const policy = state.data.modelPolicy || {};
  const resultCards = rec.results.map((item, index) => {
    const evidenceTags = item.evidence.map((entry) => entry.source.title).slice(0, 5);
    const schools = item.schoolOptions.map((school) => `
      <div class="school-option">
        <div>
          <strong>${esc(school.name)}</strong>
          <p>${esc(school.focus)}</p>
          ${renderTags(school.tags)}
        </div>
        <span>${esc(school.role)}</span>
        <em>${esc(school.scoreStatus)}</em>
      </div>
    `).join("");
    return `<article class="recommend-card">
      <header>
        <div>
          <p class="rank-label">推荐 ${index + 1} · ${esc(item.stance)}</p>
          <h3>${esc(item.title)}</h3>
          <p>${esc(item.examples.join(" / "))}</p>
        </div>
        <div class="score-badge">
          <strong>${fmtNumber(item.total)}</strong>
          <span>${esc(item.confidence)}</span>
        </div>
      </header>
      <div class="score-line"><span style="width:${item.total}%"></span></div>
      <div class="score-grid">
        ${renderScorePart("硬匹配", item.parts.hardFit)}
        ${renderScorePart("录取分位次", item.parts.scoreRank)}
        ${renderScorePart("专业适配", item.parts.majorFit)}
        ${renderScorePart("城市预算", item.parts.cityBudget)}
        ${renderScorePart("证据", item.parts.evidence)}
        ${renderScorePart("风险扣分", item.parts.riskPenalty)}
      </div>
      <section>
        <h4>模型建议院校</h4>
        <div class="school-option-list">${schools}</div>
      </section>
      <section>
        <h4>为什么推荐</h4>
        <ul>${item.reasons.map((reason) => `<li>${esc(reason)}</li>`).join("")}</ul>
      </section>
      <section>
        <h4>风险和排除条件</h4>
        <ul>${item.warnings.map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul>
      </section>
      <p class="confidence-text">${esc(item.confidenceReason)}</p>
      ${renderTags(evidenceTags, item.confidence === "A-" ? "" : "warn")}
    </article>`;
  }).join("");

  return `<section class="recommend-results">
    <div class="model-summary">
      <div>
        <h3>${esc(rec.band.label)}推荐结果</h3>
        <p>${esc(rec.band.strategy)}</p>
        ${renderRankEstimateNotice(rec.profile)}
      </div>
      <div class="model-pill">${esc(policy.version || "local-deterministic-v1")}</div>
    </div>
    ${renderAdmissionHitPanel(rec.profile)}
    <div class="grid-2">${resultCards}</div>
    <section class="band">
      <h3>官方复核清单</h3>
      <div class="check-grid">
        ${(policy.officialChecks || state.data.riskChecklist.map((item) => item.text)).map((item) => `<span>${esc(item)}</span>`).join("")}
      </div>
    </section>
  </section>`;
}

function renderAdmissionScoreLayer() {
  const layer = state.data.admissionScoreLayer || {};
  const evidenceTags = (layer.availableEvidenceIds || []).map((id) => sourceById(id)?.title).filter(Boolean).slice(0, 6);
  const coverage = layer.coverage || {};
  const rankCoverage = layer.rankCoverage || {};
  const rankSourceCoverage = layer.rankSourceCoverage || {};
  const sourceNotes = layer.sourceNotes || [];
  const dataTypes = coverage.dataTypes || {};
  const trendCoverage = coverage.majorTrendCoverage || {};
  const provinceReadiness = layer.provinceReadiness || coverage.provinceReadiness || {};
  const provinceReadinessRows = provinceReadiness.rows || [];
  const weakestProvinces = provinceReadiness.weakest || [];
  const schoolTags = coverage.schools || [];
  const scoreRange = coverage.scoreRange;
  const rankScoreRange = rankCoverage.scoreRange;
  const lowBands = coverage.lowBands || {};
  const filingProvinces = [...new Set((layer.records || [])
    .filter((record) => record.dataType === "institution-admission" && String(record.sourceQuality || "").includes("filing"))
    .map((record) => record.province)
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const vocationalProvinces = (coverage.provinceBreakdown || [])
    .filter((item) => item.dataTypes?.["vocational-admission"])
    .map((item) => item.province);
  const planProvinces = (coverage.provinceBreakdown || [])
    .filter((item) => item.dataTypes?.["admission-plan"])
    .map((item) => item.province);
  const sourceCount = sourceNotes.length;
  const tables = (layer.requiredTables || []).map((table) => `
    <article class="score-data-card">
      <h4>${esc(table.title)}</h4>
      <p>${esc(table.purpose)}</p>
      ${renderTags(table.requiredColumns.slice(0, 8), "warn")}
    </article>
  `).join("");
  return `<section class="admission-layer">
    <div>
      <h3>录取分数据层</h3>
      <p>${esc(layer.currentFinding || "正在检查本地录取分数据。")}</p>
      <strong>${esc(layer.statusLabel || "未接入结构化院校/专业录取分表")}</strong>
      <div class="coverage-row">
        <span>记录 ${fmtNumber(coverage.records || 0)}</span>
        <span>省份 ${(coverage.provinces || []).join("、") || "待导入"}</span>
        <span>年份 ${(coverage.years || []).join("、") || "待导入"}</span>
        <span>院校 ${fmtNumber((coverage.schools || []).length)}</span>
      </div>
      <div class="coverage-row compact">
        <span>专业录取 ${fmtNumber(dataTypes["major-admission"] || 0)}</span>
        <span>院校投档 ${fmtNumber(dataTypes["institution-admission"] || 0)}</span>
        <span>专业组 ${fmtNumber(dataTypes["major-group-admission"] || 0)}</span>
        <span>高职专科 ${fmtNumber(dataTypes["vocational-admission"] || 0)}</span>
        <span>招生计划 ${fmtNumber(dataTypes["admission-plan"] || layer.admissionPlanRecords || 0)}</span>
        <span>批次线 ${fmtNumber(dataTypes["control-line"] || 0)}</span>
        <span>一分一段 ${fmtNumber(layer.rankConversionRecords || rankCoverage.records || 0)}</span>
        ${layer.admissionPlanCount ? `<span>计划数 ${fmtNumber(layer.admissionPlanCount)}</span>` : ""}
        <span>位次来源页 ${fmtNumber(rankSourceCoverage.sources || 0)}</span>
        <span>来源页 ${fmtNumber(sourceCount)}</span>
        ${scoreRange ? `<span>分数带 ${fmtNumber(scoreRange.min)}-${fmtNumber(scoreRange.max)}</span>` : ""}
        <span>城市 ${fmtNumber((coverage.cities || []).length)}</span>
      </div>
      ${rankSourceCoverage.sources ? `<div class="coverage-row compact">
        <span>可计算位次页 ${fmtNumber(rankSourceCoverage.parsedSources || 0)}</span>
        <span>待解析位次页 ${fmtNumber(rankSourceCoverage.queuedSources || 0)}</span>
        <span>图片位次页 ${fmtNumber(rankSourceCoverage.imageQueuedSources || 0)}</span>
        <span>位次来源年份 ${(rankSourceCoverage.years || []).join("、") || "待导入"}</span>
        <span>可计算省份 ${(rankSourceCoverage.parsedProvinces || []).join("、") || "待导入"}</span>
      </div>` : ""}
      ${(rankSourceCoverage.queuedProvinces || []).length ? `<div class="coverage-row compact">
        <span>已采待解析省份</span>
        ${(rankSourceCoverage.queuedProvinces || []).map((province) => `<span>${esc(province)}</span>`).join("")}
      </div>` : ""}
      <div class="coverage-row compact">
        <span>双年可比专业 ${fmtNumber(trendCoverage.comparableMajorPairs || 0)}</span>
        <span>双年可比位次 ${fmtNumber(trendCoverage.comparableMajorPairsWithRank || 0)}</span>
        <span>热点双年专业 ${fmtNumber(trendCoverage.comparableHotMajorPairs || 0)}</span>
        <span>三年可比专业 ${fmtNumber(trendCoverage.comparableMajorSeries3y || 0)}</span>
        <span>三年可比位次 ${fmtNumber(trendCoverage.comparableMajorSeries3yWithRank || 0)}</span>
        <span>热点三年专业 ${fmtNumber(trendCoverage.comparableHotMajorSeries3y || 0)}</span>
        <span>四年可比专业 ${fmtNumber(trendCoverage.comparableMajorSeries4y || 0)}</span>
        <span>四年可比位次 ${fmtNumber(trendCoverage.comparableMajorSeries4yWithRank || 0)}</span>
        <span>最长趋势 ${fmtNumber(trendCoverage.longestMajorSeriesYears || 0)}年</span>
        <span>趋势省份 ${fmtNumber((trendCoverage.provinces || []).length)}</span>
      </div>
      ${provinceReadinessRows.length ? `<div class="coverage-row compact">
        <span>强证据省份 ${fmtNumber(provinceReadiness.strong || 0)}</span>
        <span>可用省份 ${fmtNumber(provinceReadiness.usable || 0)}</span>
        <span>种子省份 ${fmtNumber(provinceReadiness.seed || 0)}</span>
        <span>待加厚省份 ${fmtNumber(provinceReadiness.thin || 0)}</span>
        <span>可估位省份 ${fmtNumber(provinceReadiness.rankReady || 0)}</span>
        <span>专科可用省份 ${fmtNumber(provinceReadiness.vocationalReady || 0)}</span>
        <span>三年趋势省份 ${fmtNumber(provinceReadiness.trend3yReady || 0)}</span>
        <span>四年趋势省份 ${fmtNumber(provinceReadiness.trend4yReady || 0)}</span>
      </div>` : ""}
      ${weakestProvinces.length ? `<div class="coverage-row compact">
        <span>优先补数省份</span>
        ${weakestProvinces.map((row) => `<span>${esc(row.province)} ${fmtNumber(row.readinessScore)} ${esc(row.statusLabel)}</span>`).join("")}
      </div>` : ""}
      ${provinceReadinessRows.length ? `<div class="source-chip-list province-readiness-list">
        ${provinceReadinessRows.map((row) => `<span title="${esc((row.missing || []).join("；") || row.recommendationUse || "")}">${esc(row.province)} ${fmtNumber(row.readinessScore)} ${esc(row.statusLabel)} · 专业${fmtNumber(row.majorRecords || 0)} · 位次${fmtNumber(row.majorWithRank || 0)} · 计划${fmtNumber(row.planRecords || 0)} · 趋势${fmtNumber(row.trend3y || 0)}/${fmtNumber(row.trend4y || 0)}</span>`).join("")}
      </div>` : ""}
      <div class="coverage-row compact">
        <span>250分以下 ${fmtNumber(lowBands.below250 || 0)}</span>
        <span>300分以下 ${fmtNumber(lowBands.below300 || 0)}</span>
        <span>500分以下 ${fmtNumber(lowBands.below500 || 0)}</span>
        <span>本科投档省份 ${filingProvinces.join("、") || "待导入"}</span>
        <span>专科省份 ${vocationalProvinces.join("、") || "待导入"}</span>
        <span>计划省份 ${planProvinces.join("、") || "待导入"}</span>
      </div>
      ${(rankCoverage.provinces || []).length ? `<div class="coverage-row compact">
        <span>位次省份 ${(rankCoverage.provinces || []).join("、")}</span>
        <span>位次年份 ${(rankCoverage.years || []).join("、")}</span>
        <span>位次科类 ${(rankCoverage.subjects || []).join("、")}</span>
        ${rankScoreRange ? `<span>一分一段分数 ${fmtNumber(rankScoreRange.min)}-${fmtNumber(rankScoreRange.max)}</span>` : ""}
      </div>` : ""}
      ${(coverage.schoolTags || []).length ? `<div class="coverage-row compact">
        ${(coverage.schoolTags || []).slice(0, 10).map((tag) => `<span>${esc(tag)}</span>`).join("")}
      </div>` : ""}
      ${schoolTags.length ? `<div class="source-chip-list">${schoolTags.map((name) => `<span>${esc(name)}</span>`).join("")}</div>` : ""}
      ${renderTags(evidenceTags)}
    </div>
    <div class="grid-3">${tables}</div>
    ${sourceNotes.length ? `<div class="score-source-list">
      ${sourceNotes.slice(0, 12).map((source) => `<a href="${esc(source.url)}" target="_blank" rel="noreferrer">${esc(source.title)} · ${esc(source.quality)}</a>`).join("")}
      ${sourceNotes.length > 12 ? `<span>另有 ${fmtNumber(sourceNotes.length - 12)} 个来源已入库，详见 data/admissions/sources。</span>` : ""}
    </div>` : ""}
  </section>`;
}

function bindRecommendEvents() {
  const form = $("#recommendForm");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    runRecommendation();
  });
  $("#resetRecommend").addEventListener("click", () => {
    state.recommendation = null;
    renderRecommend();
  });
}

function renderAdmissionHitPanel(profile) {
  const records = profileAdmissionRecords(profile)
    .map((record) => {
      const fit = admissionFit(record, profile);
      return { record, fit, score: fit.score + majorInterestScore(record, profile) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  if (!records.length) {
    return `<section class="band admission-hit-panel">
      <h3>当前省份数据状态</h3>
      <p>本地已有全国通用数据 schema，但暂未导入${esc(profile.province || "该省")}${esc(profile.subject || "")}的结构化录取记录。本次结果会按全国候选池和本地经验知识降级输出；继续导入该省考试院投档表、院校专业分和一分一段表后，可自动升级为分数/位次排序。</p>
    </section>`;
  }
  return `<section class="band admission-hit-panel">
    <h3>已命中的本省同科类录取数据</h3>
    <div class="admission-hit-list">
      ${records.map(({ record, fit }) => `
        <div class="admission-hit">
          <strong>${esc(record.schoolName)} · ${esc(record.majorName || record.majorGroup || "专业组")}</strong>
          <span>${esc(fit.zone)}</span>
          <p>${esc(fit.text)}${record.minScore ? `；最低分${record.minScore}` : ""}${record.rankRangeText ? `；位次${record.rankRangeText}` : ""}</p>
        </div>
      `).join("")}
    </div>
  </section>`;
}

function renderRecommend() {
  const policy = state.data.modelPolicy || {
    name: "本地高考志愿可靠推荐模型",
    formula: "总分 = 35%硬匹配 + 25%分数位次策略 + 20%专业适配 + 10%城市预算 + 10%证据充分度 - 红线风险扣分",
    reliabilityDefinition: "公开权重、来源证据、置信度标签、排除理由和官方复核清单。",
    weights: [],
    confidenceRules: [],
  };
  const sourceTags = (policy.sourceIds || []).map((id) => sourceById(id)?.title).filter(Boolean).slice(0, 5);
  const profile = state.recommendation?.profile || DEFAULT_PROFILE;
  $("#view-recommend").innerHTML = `
    ${sectionHead("智能推荐", "告诉我孩子是什么类型、多少分/位次、想去哪类城市和专业，系统自动给出候选院校池、排序理由和复核清单。")}
    <section class="model-band">
      <div>
        <h3>${esc(policy.name)}</h3>
        <p>${esc(policy.reliabilityDefinition)}</p>
        <p class="formula">${esc(policy.formula)}</p>
        ${renderTags(sourceTags)}
      </div>
      <div class="weight-list">
        ${(policy.weights || []).map((item) => `<div><strong>${esc(item.label)}</strong><span>${Math.round(item.weight * 100)}%</span></div>`).join("")}
      </div>
    </section>
    ${renderAdmissionScoreLayer()}
    <section class="band">
      <h3>输入画像</h3>
      ${renderRecommendForm(profile)}
    </section>
    ${renderRecommendationResults()}
    <section class="band">
      <h3>可信度规则</h3>
      <div class="check-grid">
        ${(policy.confidenceRules || []).map((item) => `<span>${esc(item)}</span>`).join("")}
      </div>
    </section>
  `;
  bindRecommendEvents();
}

function renderRounds() {
  const rounds = state.data.rounds.map((round) => `
    <article class="round-card">
      <header>
        <div>
          <h3>Round ${round.id} ${esc(round.title)}</h3>
          <p>${esc(round.purpose)}</p>
        </div>
        <span class="tag">${fmtNumber(round.coverage.totalFilesSeen)} 文件全量过表</span>
      </header>
      <ul>
        ${round.integratedNotes.map((note) => `<li>${esc(note)}</li>`).join("")}
      </ul>
      <div class="tag-row">
        <span class="tag">命中 ${fmtNumber(round.coverage.matchedFilesForLens)}</span>
        <span class="tag">正文 ${fmtNumber(round.coverage.textExtractedFiles)}</span>
        <span class="tag warn">索引-only ${fmtNumber(round.coverage.indexedOnlyFiles)}</span>
      </div>
    </article>`).join("");

  $("#view-rounds").innerHTML = `
    ${sectionHead(`${state.data.rounds.length}轮沉淀`, "每轮都覆盖同一批资料清单，并把命中来源、主题和经验写入可追溯记录。")}
    <div class="round-list">${rounds}</div>
  `;
}

function renderAudioQueue() {
  const query = state.query.trim().toLowerCase();
  const queue = state.data.audioQueue;
  const seriesCards = queue.series.map((series) => {
    const items = series.items.filter((item) => {
      const text = [item.title, item.relativePath, item.priority, item.reason, item.domains.join(" "), item.disciplines.join(" ")].join(" ").toLowerCase();
      return !query || text.includes(query);
    });
    if (!items.length) return "";
    const pendingCount = series.items.filter((item) => item.processingStatus !== "asr-transcribed").length;
    const priorityTags = Object.entries(series.priorities)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([priority, count]) => `${priority} ${count}`);
    return `<article class="round-card">
      <header>
        <div>
          <h3>${esc(series.series)}</h3>
          <p>${fmtNumber(series.files)} 个音频 · ${fmtBytes(series.bytes)}</p>
        </div>
        <span class="tag ${pendingCount ? "warn" : ""}">${pendingCount ? `待 ASR ${pendingCount}` : "ASR完成"}</span>
      </header>
      ${renderTags(priorityTags)}
      <div class="source-list">
        ${items.slice(0, 18).map((item) => `
          <div class="source-row">
            <div>
              <h4>${esc(item.title)}</h4>
              <p>${esc(item.relativePath)}</p>
              ${renderTags([item.priority, item.reason, ...item.domains, ...item.disciplines, item.duplicateGroupSize > 1 ? `重复组 ${item.duplicateGroupSize}` : ""].filter(Boolean).slice(0, 8), item.priority === "P0" ? "risk" : "")}
            </div>
            <span class="status ${item.processingStatus === "audio-indexed-needs-transcript" ? "gap" : ""}">${esc(statusLabel(item.processingStatus))}</span>
            <span class="status">${esc(item.ext)} · ${fmtBytes(item.bytes)}</span>
          </div>
        `).join("")}
      </div>
    </article>`;
  }).filter(Boolean).join("");

  $("#view-audio").innerHTML = `
    ${sectionHead("音频 ASR 库", "124 个音频已按课程系列归档，并通过本地 whisper.cpp 完成完整离线转写；WMA 通过 ffmpeg 临时转码后处理。")}
    <div class="metric-grid">
      ${renderMetric("音频文件", queue.totalFiles)}
      ${renderMetric("ASR完整转写", state.data.extractionStats.asrTranscribedFiles)}
      ${renderMetric("ASR部分转写", state.data.extractionStats.asrPartialFiles)}
      ${renderMetric("音频待转写", state.data.extractionStats.needsAudioTranscriptFiles)}
      ${renderMetric("音频体量 GiB", (queue.totalBytes / 1024 / 1024 / 1024).toFixed(2))}
      ${renderMetric("重复标题组", queue.duplicateGroups)}
      ${Object.entries(queue.priorityCounts).map(([priority, count]) => renderMetric(priority, count)).join("")}
    </div>
    <div class="round-list">${seriesCards || document.querySelector("#emptyTemplate").innerHTML}</div>
  `;
}

function renderSources() {
  const sources = filteredSources();
  if (!sources.length) {
    $("#view-sources").innerHTML = document.querySelector("#emptyTemplate").innerHTML;
    return;
  }
  const rows = sources.map((source) => {
    const hasGap = source.processingStatus.includes("needs") || source.processingStatus.includes("error") || source.textLength === 0;
    const disciplineTags = source.disciplines.map((item) => `${item.code} ${item.name}`).slice(0, 3);
    const domainTags = source.domains.map((item) => item.label).slice(0, 3);
    return `<article class="source-row">
      <div>
        <h4>${esc(source.title)}</h4>
        <p>${esc(source.relativePath)}</p>
        ${source.excerpt ? `<p>${esc(source.excerpt.slice(0, 180))}</p>` : ""}
        ${renderTags([...disciplineTags, ...domainTags].slice(0, 6))}
      </div>
      <span class="status ${hasGap ? "gap" : ""}">${esc(statusLabel(source.processingStatus))}</span>
      <span class="status">${esc(source.kind)} · ${fmtBytes(source.bytes)}${source.ocrPages ? ` · OCR ${fmtNumber(source.ocrPages)}页` : ""}</span>
    </article>`;
  }).join("");

  $("#view-sources").innerHTML = `
    ${sectionHead("资料库", `${fmtNumber(sources.length)} 个文件匹配当前筛选。`)}
    <div class="source-list">${rows}</div>
  `;
}

function render() {
  renderOverview();
  renderRecommend();
  renderDisciplines();
  renderRules();
  renderRounds();
  renderAudioQueue();
  renderSources();
}

function updateView(nextView) {
  state.view = nextView;
  $$(".nav-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === nextView));
  $$(".view").forEach((view) => view.classList.remove("active-view"));
  $(`#view-${nextView}`).classList.add("active-view");
}

function bindEvents() {
  $$(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => updateView(btn.dataset.view));
  });
  $("#searchInput").addEventListener("input", (event) => {
    state.query = event.target.value;
    renderSources();
    renderDisciplines();
    renderAudioQueue();
  });
  $("#disciplineFilter").addEventListener("change", (event) => {
    state.discipline = event.target.value;
    renderSources();
    renderDisciplines();
  });
  $("#domainFilter").addEventListener("change", (event) => {
    state.domain = event.target.value;
    renderSources();
    renderDisciplines();
  });
}

function populateFilters() {
  const disciplineFilter = $("#disciplineFilter");
  for (const discipline of state.data.disciplines) {
    const option = document.createElement("option");
    option.value = discipline.code;
    option.textContent = `${discipline.code} ${discipline.name}`;
    disciplineFilter.appendChild(option);
  }

  const domainFilter = $("#domainFilter");
  for (const domain of state.data.domains) {
    const option = document.createElement("option");
    option.value = domain.id;
    option.textContent = domain.label;
    domainFilter.appendChild(option);
  }
}

async function boot() {
  const response = await fetch("./data/knowledge.json", { cache: "no-store" });
  state.data = await response.json();
  $("#generatedAt").textContent = `更新于 ${new Date(state.data.generatedAt).toLocaleString("zh-CN")}`;
  populateFilters();
  bindEvents();
  render();
}

boot().catch((error) => {
  document.body.innerHTML = `<div class="empty-state"><h2>数据载入失败</h2><p>${esc(error.message)}</p></div>`;
});

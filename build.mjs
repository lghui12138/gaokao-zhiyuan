#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const ADMISSION_DIR = path.join(DATA_DIR, "admissions");
const EXTRACT_DIR = path.join(DATA_DIR, "extracts");
const TRANSCRIPT_DIR = path.join(DATA_DIR, "transcripts");
const ROUND_DIR = path.join(DATA_DIR, "rounds");
const SITE_DATA_DIR = path.join(PROJECT_ROOT, "site", "data");
const REPORT_DIR = path.join(PROJECT_ROOT, "docs");
const TMP_ROOT = path.join(os.homedir(), ".codex", "tmp", "gaokao-zhiyuan-ingest");

const SOURCE_ROOTS = [
  "/Volumes/mac_2T/赠送：其他机构老师课程",
  "/Volumes/mac_2T/6—电子书与电子资料",
];

const ALL_PROVINCES = [
  "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江", "上海", "江苏",
  "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "广西",
  "海南", "重庆", "四川", "贵州", "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆",
];

const AUDIO_EXTS = new Set([".mp3", ".wma"]);
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png"]);
const TEXT_EXTS = new Set([".txt", ".md", ".csv"]);
const DOC_EXTS = new Set([".doc", ".docx"]);
const PPT_EXTS = new Set([".ppt", ".pptx"]);
const SHEET_EXTS = new Set([".xls", ".xlsx"]);
const PDF_EXTS = new Set([".pdf"]);
const OCR_TESSDATA_DIR = process.env.TESSDATA_DIR || path.join(os.homedir(), ".codex", "tessdata");
const OCR_LANG = process.env.OCR_LANG || "chi_sim";
const OCR_ENABLED = process.env.SKIP_OCR !== "1" && fs.existsSync(path.join(OCR_TESSDATA_DIR, `${OCR_LANG.split("+")[0]}.traineddata`));
const OCR_DPI = Number(process.env.OCR_DPI || 150);
const REUSE_EXTRACTS = process.env.REUSE_EXTRACTS === "1";

const DISCIPLINES = [
  {
    code: "01",
    name: "哲学",
    keywords: ["哲学", "逻辑学", "宗教学", "伦理"],
    guide: "关注学术训练、深造路径和人文素养匹配，通常不以短期就业口径单独决策。",
  },
  {
    code: "02",
    name: "经济学",
    keywords: ["经济", "金融", "财政", "税收", "保险", "投资", "国际经济", "贸易"],
    guide: "同时看城市金融资源、数学能力、实习机会和学校平台，不只看专业名称热度。",
  },
  {
    code: "03",
    name: "法学",
    keywords: ["法学", "法律", "公安", "政治", "社会学", "民族", "马克思"],
    guide: "区分普通法学、公安警校路径、政治学社会学等方向，提前核对体检政审和就业通道。",
  },
  {
    code: "04",
    name: "教育学",
    keywords: ["教育", "师范", "体育", "公费师范", "心理"],
    guide: "师范、公费师范和普通教育学的约束不同，要把就业地域、协议服务期和教师资格路径一起看。",
  },
  {
    code: "05",
    name: "文学",
    keywords: ["文学", "语言", "中文", "新闻", "传播", "英语", "外语", "翻译"],
    guide: "核心是表达、语言、传播和内容能力，院校平台、城市实习和复合能力会强烈影响结果。",
  },
  {
    code: "06",
    name: "历史学",
    keywords: ["历史", "考古", "文物", "博物馆"],
    guide: "偏长期学术和公共文化方向，适合把深造意愿、兴趣稳定性和就业预期提前说清楚。",
  },
  {
    code: "07",
    name: "理学",
    keywords: ["理学", "理科", "数学", "物理", "化学", "生物", "地理", "地质", "统计", "心理学", "天文", "海洋", "大气"],
    guide: "偏基础学科和方法训练，重点看兴趣、数学/实验基础、深造意愿和转向工科/数据/师范的通道。",
  },
  {
    code: "08",
    name: "工学",
    keywords: ["工学", "工科", "计算机", "软件", "电子", "电气", "自动化", "机械", "土木", "建筑", "材料", "能源", "交通", "水利", "测绘", "化工", "电力"],
    guide: "偏工程应用和产业链，优先核对行业景气、学校学科实力、实践平台、城市产业和身体限制。",
  },
  {
    code: "09",
    name: "农学",
    keywords: ["农学", "农业", "林学", "动物", "植物", "水产", "草学"],
    guide: "不要只按传统印象判断，需看细分方向、科研平台、地域产业和是否愿意走深造/基层/事业单位路径。",
  },
  {
    code: "10",
    name: "医学",
    keywords: ["医学", "临床", "口腔", "护理", "药学", "中医", "本博连读", "公共卫生", "基础医学"],
    guide: "医学强约束最多：学制、规培、身体条件、院校医院资源、地域就业和家庭承压都要提前核对。",
  },
  {
    code: "11",
    name: "军事学/军校路径",
    keywords: ["军校", "军事", "军检", "体检", "政审", "定向士官"],
    guide: "普通本科目录外要单列处理，重点是招生省份、体检政审、培养协议和服役/就业约束。",
  },
  {
    code: "12",
    name: "管理学",
    keywords: ["管理", "会计", "审计", "财务管理", "工商", "公共管理", "物流", "旅游", "信息管理", "国际商务"],
    guide: "管理类名称相近但就业差异大，最好结合行业、证书、实习城市和学校商科资源一起判断。",
  },
  {
    code: "13",
    name: "艺术学",
    keywords: ["艺术", "音乐", "美术", "设计", "戏剧", "影视", "播音"],
    guide: "艺术类要把统考校考、文化分、专业分折算和作品/就业生态单独成案。",
  },
  {
    code: "14",
    name: "交叉学科/新兴方向",
    keywords: ["交叉", "人工智能", "智能", "数据科学", "新工科", "新医科", "新文科"],
    guide: "交叉方向最怕只看名称热度，必须回到课程结构、所属学院、师资平台和真实出口。",
  },
];

const DOMAINS = [
  {
    id: "admission-rules",
    label: "录取规则与志愿策略",
    keywords: ["平行志愿", "顺序志愿", "录取规则", "投档", "退档", "调剂", "专业级差", "招生章程", "录取顺序", "志愿填报逻辑", "排序"],
  },
  {
    id: "major-discipline",
    label: "专业门类与学科理解",
    keywords: ["专业", "学科", "门类", "理学", "工学", "专业目录", "专业介绍", "专业分析", "选科"],
  },
  {
    id: "university-city",
    label: "院校层次与城市选择",
    keywords: ["大学", "院校", "高校", "城市", "985", "211", "双一流", "C9", "港澳", "上海", "武汉", "昆明", "长春", "内蒙古", "吉林"],
  },
  {
    id: "special-paths",
    label: "特殊招生与专项路径",
    keywords: ["专项计划", "综合评价", "自主招生", "公费师范", "定向士官", "军校", "警校", "本博连读", "双高计划", "港澳"],
  },
  {
    id: "constraints-risk",
    label: "体检限制与风险控制",
    keywords: ["色觉", "近视", "体检", "体测", "限制", "身高", "视力", "退档", "调剂", "风险"],
  },
  {
    id: "career-industry",
    label: "行业就业与发展现状",
    keywords: ["行业", "就业", "体制内", "体制外", "基建", "电力", "金融", "会计", "审计", "材料", "计算机"],
  },
  {
    id: "planning-family",
    label: "升学规划与家庭决策",
    keywords: ["升学规划", "家长", "高一", "高二", "高三", "寒假", "备考", "价值最大化", "期末考试"],
  },
  {
    id: "consulting-ops",
    label: "咨询服务与讲座运营",
    keywords: ["话术", "短信", "签到", "会员", "邀约", "讲座", "招生拓客", "合作模式", "登记表", "销售"],
  },
];

const ROUND_LENSES = [
  ["01", "资料全量盘点", "先建立全资料目录、文件类型、可抽取性和缺口边界。", []],
  ["02", "规则优先框架", "围绕投档、录取、调剂、退档、招生章程建立规则层。", ["平行志愿", "投档", "录取规则", "退档", "调剂", "招生章程"]],
  ["03", "新老高考差异", "把老高考、新高考、院校专业组、专业排序等逻辑分开。", ["老高考", "新高考", "院校专业组", "专业组", "志愿填报逻辑"]],
  ["04", "专业门类总表", "按中国专业门类框架把专业材料归位。", ["专业目录", "门类", "学科", "专业分类"]],
  ["05", "07 理学专题", "把理学相关资料单独沉淀，包括基础学科、深造与转向。", ["理学", "理科", "数学", "物理", "化学", "生物", "地质", "心理学"]],
  ["06", "08 工学专题", "把工科、计算机、机械、土木、电力、材料等工程方向归位。", ["工学", "工科", "计算机", "机械", "土木", "电力", "材料"]],
  ["07", "经管商科专题", "把经济、金融、会计、审计、财务管理、国际商务等归位。", ["经济", "金融", "会计", "审计", "财务管理", "国际商务"]],
  ["08", "文史哲法教专题", "把人文社科、师范教育、法学公安等资料归位。", ["文学", "历史", "哲学", "法学", "教育", "师范", "公安"]],
  ["09", "医学军警专题", "沉淀医学本博连读、军校、警校、定向士官和体检要求。", ["医学", "本博连读", "军校", "警校", "定向士官", "体检"]],
  ["10", "院校层次专题", "沉淀 985/211/双一流/C9/港澳/改名合并/分校等院校判断。", ["985", "211", "双一流", "C9", "港澳", "改名", "合并", "分校"]],
  ["11", "城市与地域专题", "沉淀城市选择、区域高校、地域就业和实习资源。", ["城市", "上海", "武汉", "昆明", "吉林", "内蒙古", "长春"]],
  ["12", "特殊招生专题", "沉淀专项计划、综合评价、公费师范、双高、港澳等路径。", ["专项计划", "综合评价", "公费师范", "双高", "港澳", "自主招生"]],
  ["13", "限制条件专题", "沉淀色觉、近视、军警体检、专业限报和退档风险。", ["色觉", "近视", "体检", "体测", "限制", "退档"]],
  ["14", "行业就业专题", "沉淀行业、体制内外、热门冷门、垄断稀缺与就业现状。", ["行业", "就业", "体制内", "体制外", "垄断", "稀缺", "热门"]],
  ["15", "家庭时间线专题", "沉淀高一高二高三、寒假、考后估分和家长准备节奏。", ["高一", "高二", "高三", "寒假", "家长", "备考", "期末"]],
  ["16", "志愿排序模型", "把专业、院校、城市、风险、分数位次组合成决策模型。", ["专业", "大学", "城市", "排序", "冲", "稳", "保", "位次"]],
  ["17", "咨询经验沉淀", "从讲座、话术、问卷和报告模板中抽出沟通经验。", ["话术", "讲座", "问卷", "报告", "咨询", "邀约"]],
  ["18", "风险案例归纳", "集中处理退档、调剂、限报、校名误判、热门专业误判。", ["退档", "调剂", "限制", "改名", "合并", "热门", "材料"]],
  ["19", "数据使用方法", "沉淀数据库、往年录取、专业目录、学科评估的使用边界。", ["数据库", "往年", "录取", "专业目录", "学科评估", "院校名单"]],
  ["20", "最终分类融合", "把所有材料重新扫过并融合到网站可用分类。", []],
  ["21", "一致性与缺口审计", "审计每个文件是否被覆盖，哪些内容还需要 OCR/音频转写。", []],
  ["22", "省份批次与官方核验", "继续全量过表，把省份批次、招生计划、院校代码和官方核验点单独沉淀。", ["省", "批次", "考试院", "招生计划", "招生章程", "院校代码", "专业代码"]],
  ["23", "选科约束与学科关联", "继续全量过表，把高中选科、大学学科和院校专业组限制合并审计。", ["选科", "科目", "高中科目", "大学学科", "院校专业组", "物理", "历史", "化学", "生物"]],
  ["24", "课程结构与能力画像", "继续全量过表，把专业课程、能力门槛、证书和实践要求转成画像。", ["课程", "能力", "数学", "实验", "英语", "表达", "实践", "证书"]],
  ["25", "冷热专业与行业周期", "继续全量过表，拆解热门冷门、行业周期、体制内外和就业预期。", ["热门", "冷门", "行业", "周期", "就业", "体制内", "体制外", "垄断"]],
  ["26", "校名校区与合作办学辨析", "继续全量过表，把改名、合并、分校、校区和中外合作办学风险归档。", ["改名", "合并", "分校", "校区", "中外合作", "合作办学", "独立学院"]],
  ["27", "院校实力证据链", "继续全量过表，把学科评估、双一流、985/211、博士点等证据分层。", ["学科评估", "双一流", "985", "211", "C9", "重点学科", "博士点", "硕士点"]],
  ["28", "城市群与地域机会", "继续全量过表，把城市产业、区域高校、实习机会和家庭成本联系起来。", ["城市", "上海", "武汉", "昆明", "吉林", "长春", "内蒙古", "港澳", "实习"]],
  ["29", "家庭预算与沟通心理", "继续全量过表，把家庭成本、家长沟通、心理预期和孩子接受度沉淀。", ["家长", "家庭", "成本", "学费", "心理", "焦虑", "沟通", "孩子"]],
  ["30", "分数位次与历史数据", "继续全量过表，把分数、位次、往年录取、数据库和招生计划使用边界细化。", ["分数", "位次", "排名", "往年", "录取", "数据库", "一分一段", "招生计划"]],
  ["31", "冲稳保与方案兜底", "继续全量过表，把冲稳保、梯度、排序、兜底和可接受度组合成方案层。", ["冲", "稳", "保", "垫", "方案", "组合", "排序", "梯度"]],
  ["32", "调剂退档与章程复盘", "继续全量过表，把退档、调剂、专业级差、服从调剂和招生章程复盘为风险动作。", ["调剂", "退档", "招生章程", "录取规则", "专业级差", "投档", "服从"]],
  ["33", "特殊路径资格窗口", "继续全量过表，把综评、专项、公费师范、军警、港澳和自主招生按资格窗口沉淀。", ["综合评价", "专项计划", "公费师范", "定向士官", "军校", "警校", "港澳", "自主招生"]],
  ["34", "长周期专业路径", "继续全量过表，把医学、师范、法学、公安等长期投入路径单独复核。", ["医学", "师范", "法学", "教师", "规培", "教师资格", "公安", "警校"]],
  ["35", "理工基础与交叉方向", "继续全量过表，把理学、工学、计算机、数据和新兴交叉方向重新融合。", ["理学", "工学", "数学", "物理", "化学", "生物", "计算机", "数据", "交叉"]],
  ["36", "经管文法商科现实层", "继续全量过表，把经管商科、人文法学和国际商务的真实出口合并审计。", ["经济", "金融", "管理", "会计", "审计", "文学", "法学", "国际商务", "新闻"]],
  ["37", "高职专科与职业教育", "继续全量过表，把高职专科、双高、技能路径和专升本边界补成独立层。", ["专科", "高职", "职业教育", "双高", "技能", "职业", "专升本"]],
  ["38", "低分高就与捡漏误区", "继续全量过表，把低分高就、另辟蹊径、港澳机会和捡漏误区分开。", ["低分高就", "捡漏", "机会", "误区", "另辟蹊径", "名校", "港澳"]],
  ["39", "高三临门一脚", "继续全量过表，把寒假、期末、最后半学期、估分和方案复核沉淀。", ["高三", "寒假", "期末", "最后半学期", "备考", "估分", "准备"]],
  ["40", "问诊 FAQ 与家长问题库", "继续全量过表，把答疑、常识、名词解释、咨询话术和报告模板沉淀为问诊库。", ["答疑", "常识", "名词", "咨询", "问卷", "报告", "话术", "讲座"]],
  ["41", "二次总审与推荐骨架", "继续全量过表，把新增 20 轮再次汇总成可用于后续推荐器的骨架。", []],
  ["42", "用户画像字段升级", "继续全量过表，把用户输入拆成推荐器必需字段和可选偏好字段。", ["省份", "科类", "选科", "位次", "预算", "城市", "专业偏好", "不可接受"]],
  ["43", "硬过滤规则引擎", "继续全量过表，把体检、选科、批次、语种、协议和资格条件升级成硬过滤规则。", ["体检", "选科", "批次", "语种", "协议", "资格", "限报", "服务期"]],
  ["44", "软评分权重体系", "继续全量过表，把专业、院校、城市、就业、家庭和风险转成可调权重。", ["权重", "专业", "院校", "城市", "就业", "家庭", "风险", "排序"]],
  ["45", "专业适配深描", "继续全量过表，把兴趣、课程、能力、深造和职业出口组合成专业适配判断。", ["兴趣", "课程", "能力", "深造", "职业", "出口", "适合", "专业"]],
  ["46", "院校平台分层", "继续全量过表，把学校平台、学科实力、行业认可、校区和资源做分层。", ["平台", "学科实力", "认可", "校区", "资源", "博士点", "硕士点", "双一流"]],
  ["47", "城市产业映射", "继续全量过表，把城市、产业、实习、就业、地域成本和家庭距离映射到方案。", ["城市", "产业", "实习", "就业", "成本", "距离", "地域", "机会"]],
  ["48", "风险红线系统", "继续全量过表，把退档、调剂、限报、学费、校区和不可接受项转成红线。", ["红线", "退档", "调剂", "限报", "学费", "校区", "不可接受", "风险"]],
  ["49", "证据置信度分级", "继续全量过表，把官方文件、目录、学科评估、讲座经验和话术按置信度分层。", ["官方", "考试院", "招生章程", "目录", "学科评估", "讲座", "经验", "话术"]],
  ["50", "来源追溯与引用层", "继续全量过表，把每条建议背后的文件、音频、OCR/ASR状态和摘录形成追溯层。", ["来源", "摘录", "文件", "音频", "OCR", "ASR", "报告", "追溯"]],
  ["51", "交互问诊路径", "继续全量过表，把家长/学生问诊流程拆成先规则、再偏好、后方案的交互路径。", ["问诊", "家长", "学生", "偏好", "问题", "答疑", "流程", "确认"]],
  ["52", "方案生成模板", "继续全量过表，把冲稳保志愿方案转成可输出模板和复核表。", ["模板", "方案", "冲", "稳", "保", "复核", "表", "排序"]],
  ["53", "志愿单元解释器", "继续全量过表，把每个志愿单元为什么推荐、为什么保留、为什么排除解释清楚。", ["解释", "推荐", "排除", "保留", "原因", "专业", "院校", "风险"]],
  ["54", "家长协同面板", "继续全量过表，把家长任务、孩子偏好、预算红线和沟通事项沉淀成协同面板。", ["家长", "孩子", "预算", "沟通", "任务", "偏好", "红线", "确认"]],
  ["55", "政策变化预警", "继续全量过表，把年份、省份、计划变化、专业组调整和章程更新沉淀为预警。", ["政策", "年份", "变化", "招生计划", "专业组", "章程", "更新", "预警"]],
  ["56", "质量审校与人工复核", "继续全量过表，把 OCR/ASR 误差、旧 Office 抽取和低清扫描列入质量复核流程。", ["OCR", "ASR", "误差", "扫描", "人工复核", "质量", "旧版", "抽取"]],
  ["57", "本科专科双路径推荐", "继续全量过表，把本科、高职专科、双高、专升本和技能就业做双路径推荐。", ["本科", "专科", "高职", "双高", "专升本", "技能", "就业", "职业"]],
  ["58", "特殊成本与收益核算", "继续全量过表，把中外合作、港澳、医学长学制、军警师范协议的成本收益列清。", ["中外合作", "港澳", "医学", "军警", "师范", "协议", "成本", "收益"]],
  ["59", "冷启动推荐问题集", "继续全量过表，把第一次使用网站必须回答的问题沉淀成冷启动问卷。", ["第一次", "使用", "问卷", "问题", "位次", "预算", "城市", "偏好"]],
  ["60", "升级版闭环审计", "继续全量过表，把输入、过滤、评分、解释、复核、追溯形成闭环审计。", ["输入", "过滤", "评分", "解释", "复核", "追溯", "闭环", "审计"]],
  ["61", "全面升级总审", "继续全量过表，把 61 轮内容汇总为下一阶段本地推荐系统的实施蓝图。", []],
  ["62", "模型可靠性边界", "继续全量过表，把可靠推荐定义为确定性规则、公开权重、来源证据、置信度和官方复核。", ["可靠", "模型", "规则", "权重", "来源", "证据", "复核", "官方"]],
  ["63", "孩子画像类型拆分", "继续全量过表，把孩子类型拆成稳健型、冲刺型、专业兴趣强、城市资源型、预算敏感、学术深造和就业导向。", ["孩子", "学生", "兴趣", "性格", "稳健", "冲刺", "深造", "就业"]],
  ["64", "分数位次分层策略", "继续全量过表，把分数、位次、排名和往年录取资料拆成高位、上位、中位、基础四档策略。", ["分数", "位次", "排名", "往年", "录取", "一分一段", "批次", "计划"]],
  ["65", "院校候选池生成", "继续全量过表，把 985/211/双一流、C9、区域高校、港澳、师范和高职等生成院校候选池。", ["985", "211", "双一流", "C9", "院校", "大学", "港澳", "师范", "高职"]],
  ["66", "专业候选池生成", "继续全量过表，把 07理学、08工学、经管商科、医学、师范、法学和高职技能生成专业候选池。", ["理学", "工学", "经济", "管理", "医学", "师范", "法学", "专业"]],
  ["67", "院校专业城市匹配", "继续全量过表，把院校平台、专业方向和城市资源合成可排序的志愿单元。", ["院校", "专业", "城市", "平台", "资源", "实习", "就业", "地域"]],
  ["68", "冲稳保风险分段", "继续全量过表，把冲、稳、保、兜底和排除项按风险承受度分层。", ["冲", "稳", "保", "兜底", "风险", "排序", "梯度", "方案"]],
  ["69", "证据链与置信度", "继续全量过表，把来源文件、音频转写、OCR、官方规则和经验材料合成置信度标签。", ["证据", "来源", "文件", "音频", "OCR", "ASR", "官方", "置信度"]],
  ["70", "推荐理由模板", "继续全量过表，把推荐理由拆成硬匹配、专业适配、院校平台、城市资源、预算和风险六类。", ["推荐", "理由", "匹配", "适配", "平台", "城市", "预算", "风险"]],
  ["71", "排除理由模板", "继续全量过表，把不推荐理由拆成选科不符、体检限报、预算过高、调剂不可接受和证据不足。", ["排除", "不推荐", "选科", "体检", "限报", "预算", "调剂", "证据"]],
  ["72", "省份年份官方复核", "继续全量过表，把省份、年份、考试院、招生计划、院校代码、专业代码和章程列为最终复核项。", ["省份", "年份", "考试院", "招生计划", "院校代码", "专业代码", "招生章程"]],
  ["73", "家庭预算城市红线", "继续全量过表，把家庭预算、学费、城市边界、距离和不可接受项转成模型红线。", ["家庭", "预算", "学费", "城市", "距离", "红线", "不可接受", "成本"]],
  ["74", "特殊路径模型", "继续全量过表，把综评、专项、公费师范、军警、港澳、中外合作和定向士官做路径模型。", ["综合评价", "专项计划", "公费师范", "军校", "警校", "港澳", "中外合作", "定向士官"]],
  ["75", "学生人格学习风格匹配", "继续全量过表，把学习风格、课程门槛、数学实验表达能力和长期投入意愿映射到专业路径。", ["学习", "课程", "能力", "数学", "实验", "表达", "长期", "兴趣"]],
  ["76", "可解释评分公式", "继续全量过表，把硬匹配、分数位次、专业适配、城市预算、证据充分度和风险扣分写成公开公式。", ["评分", "公式", "硬匹配", "位次", "专业适配", "证据", "风险", "权重"]],
  ["77", "结果可信度标签", "继续全量过表，把推荐结果标注 A-/B/C，并说明缺少位次、省份或官方数据时的降级规则。", ["可信度", "置信度", "位次", "省份", "官方", "数据", "复核", "规则"]],
  ["78", "人工复核清单", "继续全量过表，把模型输出后必须人工确认的章程、计划、调剂、体检、学费和校区列清。", ["人工复核", "章程", "计划", "调剂", "体检", "学费", "校区", "确认"]],
  ["79", "方案对比与排序", "继续全量过表，把多个院校池按分数、偏好、风险、证据和可执行性排序对比。", ["方案", "对比", "排序", "分数", "偏好", "风险", "证据", "执行"]],
  ["80", "交互式推荐工作台", "继续全量过表，把孩子画像、分数位次、偏好红线和输出解释整合成可操作页面。", ["交互", "推荐", "工作台", "画像", "分数", "位次", "偏好", "解释"]],
  ["81", "可靠模型总审", "继续全量过表，把 81 轮资料、经验、现状和模型边界统一审计后沉淀到网站。", []],
  ["82", "具体院校选择模型", "继续全量过表，把院校池升级为具体院校候选、首选核验、稳妥核验和备选核验。", ["院校", "大学", "学校", "候选", "首选", "稳妥", "备选", "核验"]],
  ["83", "院校名单证据化", "继续全量过表，把全国高校名单、区域高校、港澳、军警医学和高职材料转成院校来源证据。", ["全国普通高等学校名单", "高校", "港澳", "军校", "警校", "医学", "高职", "名单"]],
  ["84", "最佳院校排序权重", "继续全量过表，把具体院校排序拆成平台层级、专业方向、城市资源、孩子画像、预算风险和证据强度。", ["最佳", "排序", "权重", "平台", "专业", "城市", "孩子", "证据"]],
  ["85", "院校层级与专业强度拆分", "继续全量过表，把学校层次和专业强度分开，避免只按校名光环选学校。", ["院校层次", "学科评估", "专业", "博士点", "硕士点", "双一流", "985", "211"]],
  ["86", "学校城市就业联动", "继续全量过表，把具体学校所在城市、产业、实习、就业和生活成本加入排序。", ["学校", "城市", "产业", "实习", "就业", "成本", "上海", "武汉"]],
  ["87", "院校首选稳妥备选标签", "继续全量过表，把推荐结果分成首选核验、稳妥核验、备选核验和暂不推荐。", ["首选", "稳妥", "备选", "暂不推荐", "冲", "稳", "保", "风险"]],
  ["88", "同分不同孩子分岔", "继续全量过表，沉淀同一分数下孩子画像不同导致院校选择不同的规则。", ["同分", "孩子", "画像", "兴趣", "稳健", "冲刺", "就业", "深造"]],
  ["89", "具体理由生成器", "继续全量过表，把每所院校为什么排在前面写成可解释理由。", ["理由", "为什么", "院校", "推荐", "专业", "城市", "平台", "适合"]],
  ["90", "反事实排除理由", "继续全量过表，把为什么不选某些高名气学校或高成本路径写成排除理由。", ["不选", "排除", "风险", "学费", "调剂", "体检", "高成本", "证据不足"]],
  ["91", "学校名单官方复核", "继续全量过表，把每个具体院校输出后必须核验的院校代码、招生计划、专业组和章程列清。", ["院校代码", "招生计划", "专业组", "招生章程", "专业代码", "考试院", "官方"]],
  ["92", "当年投档缺口处理", "继续全量过表，把没有当年投档线、计划变化和位次口径缺失时的模型降级规则固定。", ["投档线", "计划变化", "位次", "缺口", "降级", "往年", "录取"]],
  ["93", "数据缺口降级规则", "继续全量过表，把省份、位次、科类、选科、预算、红线缺失时的可信度降级写入模型。", ["数据缺口", "省份", "位次", "科类", "选科", "预算", "红线", "可信度"]],
  ["94", "院校专业组适配", "继续全量过表，把新高考院校专业组、组内调剂和专业代码放进具体院校复核动作。", ["院校专业组", "专业组", "组内调剂", "专业代码", "新高考", "选科"]],
  ["95", "录取概率禁区", "继续全量过表，明确没有当年官方数据时不得输出录取概率、保录承诺或必中话术。", ["录取概率", "保录", "必中", "官方", "投档", "风险", "承诺"]],
  ["96", "推荐结果可操作清单", "继续全量过表，把每个院校建议后续动作拆成查计划、读章程、看专业组、问调剂、核学费。", ["清单", "计划", "章程", "专业组", "调剂", "学费", "校区", "复核"]],
  ["97", "院校对比表", "继续全量过表，把候选院校按模型分、首选理由、主要风险、证据来源和复核动作对比。", ["对比", "院校", "模型分", "理由", "风险", "证据", "复核"]],
  ["98", "家庭会谈输出", "继续全量过表，把推荐结果转成家长和孩子能讨论的优先级、取舍和待确认问题。", ["家庭", "家长", "孩子", "讨论", "取舍", "优先级", "确认", "问题"]],
  ["99", "模型审计日志", "继续全量过表，把输入完整度、权重、扣分、证据和降级原因形成模型审计说明。", ["审计", "输入", "权重", "扣分", "证据", "降级", "模型", "说明"]],
  ["100", "终版推荐工作台升级", "继续全量过表，把具体院校建议、院校池、理由、风险、证据和复核清单统一展示。", ["工作台", "具体院校", "推荐", "理由", "风险", "证据", "复核", "展示"]],
  ["101", "百轮可靠推荐总审", "继续全量过表，把 101 轮资料吸收、模型边界和具体院校推荐统一总审。", []],
  ["102", "全国省份模型扩展", "继续全量过表，把推荐器从江西样例扩展到全国省份、科类和综合改革口径。", ["全国", "省份", "科类", "选科", "综合改革", "物理", "历史", "文理"]],
  ["103", "分省位次不可混用审计", "继续全量过表，固定同省同科类同年份位次才可比较的硬边界。", ["位次", "排名", "同省", "科类", "年份", "一分一段", "投档"]],
  ["104", "院校投档与专业录取拆分", "继续全量过表，把院校投档线、专业组线和专业录取分分成不同证据等级。", ["院校投档", "投档线", "专业组", "专业录取分", "最低分", "最低位次"]],
  ["105", "专业门类全国归档", "继续全量过表，把 01-14 门类特别是 07 理学、08 工学和新兴交叉专业统一归档。", ["门类", "理学", "工学", "交叉", "数字媒体", "计算机", "人工智能"]],
  ["106", "任意孩子画像输入", "继续全量过表，把孩子画像、单科强弱、兴趣、家庭边界和不可接受项变成通用输入。", ["孩子", "画像", "单科", "兴趣", "家庭", "不可接受", "偏好"]],
  ["107", "全国院校候选池优先级", "继续全量过表，把全国候选院校按平台、专业、城市、分数和证据优先级排序。", ["全国", "院校", "候选", "平台", "专业", "城市", "排序"]],
  ["108", "专业前景与现实出口", "继续全量过表，把计算机、数字媒体、经管、医学、师范等专业现状和出口沉淀。", ["前景", "就业", "计算机", "数字媒体", "医学", "师范", "经管"]],
  ["109", "计算机科班与泛数字方向", "继续全量过表，把计算机科学与技术、软件、数媒、人工智能等方向的适配边界拆清。", ["计算机科学与技术", "软件工程", "数字媒体技术", "人工智能", "数据科学"]],
  ["110", "冲稳保全国分层", "继续全量过表，把全国数据缺口下的冲稳保分层和降级语言统一。", ["冲", "稳", "保", "兜底", "全国", "降级", "风险"]],
  ["111", "官方数据优先级", "继续全量过表，把省考试院、学校招生网、章程、第三方汇总的证据顺序固定。", ["考试院", "招生网", "招生章程", "第三方", "官方", "来源"]],
  ["112", "第三方种子数据风控", "继续全量过表，把第三方分数页自动导入、异常扫描和复核提示写成风控规则。", ["第三方", "自动导入", "异常", "复核", "最低分", "最高分", "位次"]],
  ["113", "全国专业组兼容", "继续全量过表，把院校专业组、选科组合、组内调剂和专业代码兼容进全国模型。", ["院校专业组", "选科组合", "组内调剂", "专业代码", "新高考"]],
  ["114", "分数缺失时的候选策略", "继续全量过表，明确缺院校分、缺专业分、缺位次时只能输出候选核验而非结论。", ["缺失", "候选", "核验", "院校分", "专业分", "位次", "结论"]],
  ["115", "推荐理由全国模板", "继续全量过表，把任意省份推荐理由统一为分数证据、专业适配、城市资源和风险动作。", ["推荐理由", "分数证据", "专业适配", "城市资源", "风险动作"]],
  ["116", "排除理由全国模板", "继续全量过表，把任意省份排除理由统一为不可达、证据弱、红线冲突和调剂风险。", ["排除理由", "不可达", "证据弱", "红线", "调剂", "风险"]],
  ["117", "一分一段接入口", "继续全量过表，把未来接入一分一段、同位分和近三年趋势的接口边界固定。", ["一分一段", "同位分", "趋势", "近三年", "位次", "分数"]],
  ["118", "全国数据覆盖仪表盘", "继续全量过表，把省份、年份、学校、专业、数据类型覆盖率沉淀成仪表盘指标。", ["覆盖", "省份", "年份", "学校", "专业", "数据类型", "仪表盘"]],
  ["119", "人机协同复核流程", "继续全量过表，把模型输出后的人工核验、家长讨论和最终志愿表确认流程写清。", ["人工核验", "家长", "讨论", "最终", "志愿表", "确认"]],
  ["120", "全国可用性总审", "继续全量过表，审计网站是否从单个考生扩展为全国所有考生可用的候选系统。", ["全国", "所有考生", "可用", "候选系统", "审计", "通用"]],
  ["121", "120轮后可靠推荐总审", "继续全量过表，把 120 轮以上资料吸收、全国数据层和可靠模型边界统一总审。", []],
];

function ensureDirs() {
  for (const dir of [DATA_DIR, ADMISSION_DIR, EXTRACT_DIR, TRANSCRIPT_DIR, ROUND_DIR, SITE_DATA_DIR, REPORT_DIR, TMP_ROOT]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    timeout: options.timeout ?? 120_000,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ? String(result.error) : "",
  };
}

function hashText(value, length = 16) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, length);
}

function cleanText(input) {
  return String(input ?? "")
    .replace(/\r/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripXml(xml) {
  return cleanText(
    decodeEntities(String(xml ?? ""))
      .replace(/<w:tab\/>/g, " ")
      .replace(/<a:br\/>/g, "\n")
      .replace(/<\/(w:p|a:p|row)>/g, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function walk(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      out.push({ kind: "read-error", path: current, error: String(error) });
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
    for (const entry of entries) {
      if (entry.name.startsWith("._") || entry.name === ".DS_Store") continue;
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(next);
      } else if (entry.isFile()) {
        out.push({ kind: "file", path: next });
      }
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path, "zh-Hans-CN"));
}

function sourceRelative(absPath) {
  for (const root of SOURCE_ROOTS) {
    if (absPath.startsWith(root + path.sep)) {
      return path.join(path.basename(root), path.relative(root, absPath));
    }
  }
  return absPath;
}

function stageFile(absPath, id) {
  const dir = path.join(TMP_ROOT, id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, path.basename(absPath));
  const copied = run("/usr/bin/rsync", ["-a", "--", absPath, target], { timeout: 180_000 });
  if (!copied.ok) {
    throw new Error(copied.stderr || copied.error || `rsync failed for ${absPath}`);
  }
  return { dir, target };
}

function readZipEntry(file, entry) {
  const res = run("/usr/bin/unzip", ["-p", file, entry], { timeout: 60_000 });
  return res.ok ? res.stdout : "";
}

function listZipEntries(file) {
  const res = run("/usr/bin/unzip", ["-Z1", file], { timeout: 60_000 });
  return res.ok ? res.stdout.split(/\r?\n/).filter(Boolean) : [];
}

function extractDocx(file) {
  const xml = readZipEntry(file, "word/document.xml");
  return stripXml(xml);
}

function extractPptx(file) {
  const entries = listZipEntries(file).filter((entry) => /^ppt\/(slides|notesSlides)\/.*\.xml$/.test(entry));
  const chunks = [];
  for (const entry of entries) {
    chunks.push(stripXml(readZipEntry(file, entry)));
  }
  return cleanText(chunks.join("\n\n"));
}

function parseSharedStrings(xml) {
  const strings = [];
  const siMatches = String(xml ?? "").match(/<si[\s\S]*?<\/si>/g) ?? [];
  for (const si of siMatches) {
    const text = [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeEntities(m[1])).join("");
    strings.push(text);
  }
  return strings;
}

function extractXlsx(file) {
  const shared = parseSharedStrings(readZipEntry(file, "xl/sharedStrings.xml"));
  const entries = listZipEntries(file).filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry));
  const chunks = [];
  for (const entry of entries) {
    const xml = readZipEntry(file, entry);
    const rows = xml.match(/<row[\s\S]*?<\/row>/g) ?? [];
    for (const row of rows) {
      const cells = [];
      const cellMatches = row.match(/<c[\s\S]*?<\/c>/g) ?? [];
      for (const cell of cellMatches) {
        const type = /t="([^"]+)"/.exec(cell)?.[1] ?? "";
        const value = /<v>([\s\S]*?)<\/v>/.exec(cell)?.[1] ?? "";
        const inline = /<t[^>]*>([\s\S]*?)<\/t>/.exec(cell)?.[1] ?? "";
        if (type === "s") cells.push(shared[Number(value)] ?? "");
        else if (inline) cells.push(decodeEntities(inline));
        else cells.push(decodeEntities(value));
      }
      const line = cells.filter(Boolean).join("\t");
      if (line) chunks.push(line);
    }
  }
  return cleanText(chunks.join("\n"));
}

function extractStrings(file) {
  const wide = run("/usr/bin/strings", ["-el", file], { timeout: 60_000 });
  const plain = run("/usr/bin/strings", ["-a", file], { timeout: 60_000 });
  return cleanText([wide.stdout, plain.stdout].filter(Boolean).join("\n"));
}

function runTesseract(imagePath, psm = "6") {
  if (!OCR_ENABLED) return { text: "", ok: false, error: "Chinese OCR language data is not installed." };
  const result = run("/opt/homebrew/bin/tesseract", [
    imagePath,
    "stdout",
    "-l",
    OCR_LANG,
    "--tessdata-dir",
    OCR_TESSDATA_DIR,
    "--psm",
    psm,
  ], { timeout: 180_000, maxBuffer: 32 * 1024 * 1024 });
  return {
    text: result.ok ? cleanText(result.stdout) : "",
    ok: result.ok,
    error: result.ok ? "" : cleanText(`${result.stderr}\n${result.error}`),
  };
}

function extractImageOcr(file) {
  const ocr = runTesseract(file, "6");
  if (ocr.text.length > 10) {
    return {
      text: ocr.text,
      meta: {
        processingStatus: "ocr-extracted",
        ocrLanguage: OCR_LANG,
        ocrPages: 1,
      },
    };
  }
  return {
    text: "",
    meta: {
      processingStatus: "image-indexed-needs-chinese-ocr",
      gap: OCR_ENABLED ? "图片已尝试中文 OCR，但可用文本不足，需要人工复核或更高质量 OCR。" : "图片已进入索引；当前没有可用中文 OCR 语言包。",
      ocrLanguage: OCR_ENABLED ? OCR_LANG : "",
      ocrError: ocr.error,
    },
  };
}

function extractPdfOcr(file, pages) {
  if (!OCR_ENABLED || !pages) {
  return {
    text: "",
    meta: {
      processingStatus: "pdf-indexed-needs-chinese-ocr",
      needsChineseOcr: true,
      pages,
      gap: "PDF 文本层不足，且当前没有可用中文 OCR。",
    },
  };
  }
  const dir = path.dirname(file);
  const chunks = [];
  const errors = [];
  let ocrPages = 0;
  for (let page = 1; page <= pages; page += 1) {
    const prefix = path.join(dir, `ocr-page-${page}`);
    const image = `${prefix}.png`;
    const rendered = run("/opt/homebrew/bin/pdftoppm", [
      "-f",
      String(page),
      "-l",
      String(page),
      "-r",
      String(OCR_DPI),
      "-png",
      "-singlefile",
      file,
      prefix,
    ], { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
    if (!rendered.ok || !fs.existsSync(image)) {
      errors.push(`page ${page}: ${cleanText(rendered.stderr || rendered.error || "render failed")}`);
      continue;
    }
    const ocr = runTesseract(image, "6");
    fs.rmSync(image, { force: true });
    if (ocr.text) {
      chunks.push(`【OCR第${page}页】\n${ocr.text}`);
      ocrPages += 1;
    } else if (ocr.error) {
      errors.push(`page ${page}: ${ocr.error}`);
    }
  }
  const text = cleanText(chunks.join("\n\n"));
  return {
    text,
    meta: {
      processingStatus: text ? "ocr-extracted" : "pdf-indexed-needs-chinese-ocr",
      needsChineseOcr: !text,
      pages,
      gap: text ? "" : "PDF 已尝试中文 OCR，但没有得到可用文本，需要人工复核。",
      ocrLanguage: OCR_LANG,
      ocrPages,
      ocrErrors: errors.slice(0, 12),
    },
  };
}

function extractPdf(file) {
  const info = run("/opt/homebrew/bin/pdfinfo", [file], { timeout: 60_000 });
  const pages = Number(/^Pages:\s+(\d+)/m.exec(info.stdout)?.[1] ?? 0);
  const text = run("/opt/homebrew/bin/pdftotext", ["-layout", file, "-"], { timeout: 180_000 });
  const cleaned = cleanText(text.stdout);
  if (cleaned.length <= 80 && pages > 0) {
    return extractPdfOcr(file, pages);
  }
  return {
    text: cleaned,
    meta: {
      processingStatus: "text-extracted",
      pages,
      pdfTextExtracted: cleaned.length > 80,
      needsChineseOcr: cleaned.length <= 80 && pages > 0,
    },
  };
}

function extractWithTextutil(file) {
  const result = run("/usr/bin/textutil", ["-convert", "txt", "-stdout", file], { timeout: 120_000 });
  return result.ok ? cleanText(result.stdout) : "";
}

function audioMeta(absPath) {
  const title = path.basename(absPath, path.extname(absPath));
  return {
    titleText: title,
    processingStatus: "audio-indexed-needs-transcript",
    gap: "音频文件已进入全量索引和主题分类；未找到对应转写稿时会显示为待转写。",
  };
}

function audioTranscript(id) {
  const transcriptPath = path.join(TRANSCRIPT_DIR, `${id}.txt`);
  if (!fs.existsSync(transcriptPath)) return null;
  let meta = {};
  const metaPath = path.join(TRANSCRIPT_DIR, `${id}.json`);
  if (fs.existsSync(metaPath)) {
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    } catch {
      meta = {};
    }
  }
  const partial = Boolean(meta.partial);
  return {
    text: fs.readFileSync(transcriptPath, "utf8"),
    meta: {
      processingStatus: partial ? "asr-partial-transcribed" : "asr-transcribed",
      gap: partial ? "已有部分离线 ASR 转写；仍需全量转写后才能算全文吸收。" : "",
      asrModel: meta.model || "",
      asrDurationMs: meta.durationMs || 0,
      asrGeneratedAt: meta.generatedAt || "",
    },
  };
}

function audioSeries(relativePath) {
  const parts = relativePath.split(path.sep);
  const audioIndex = parts.findIndex((part) => /音频|必听课|家长必听|音乐/.test(part));
  if (audioIndex >= 0 && audioIndex < parts.length - 1) {
    return parts.slice(0, parts.length - 1).join(" / ");
  }
  return parts.slice(0, Math.max(1, parts.length - 1)).join(" / ");
}

function audioOrder(title) {
  const match = /^(\d{1,2})/.exec(title);
  return match ? Number(match[1]) : 999;
}

function normalizedAudioTitle(title) {
  return title
    .replace(/_20\d{12,14}$/g, "")
    .replace(/[（(]\d+[）)]$/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function audioPriority(title, relativePath) {
  const text = `${title} ${relativePath}`;
  const rules = [
    ["P0", "规则风险优先转写", ["录取规则", "投档", "平行志愿", "顺序志愿", "退档", "调剂", "招生章程", "术语", "关键要素", "核心知识", "排序"]],
    ["P1", "专业门类优先转写", ["专业介绍", "理科", "工科", "文科", "化学", "生物", "机械", "建筑", "土木", "金融", "经济学", "会计", "审计", "财务管理", "计算机", "心理学", "地质"]],
    ["P2", "院校城市优先转写", ["大学", "院校", "高校", "城市", "港澳", "985", "211", "双一流", "改名", "合并", "分校", "上海", "武汉", "昆明", "长春", "内蒙古", "吉林"]],
    ["P3", "规划经验转写", ["升学规划", "家长", "高一", "高二", "高三", "寒假", "备考", "分数价值", "机会取舍"]],
    ["P4", "一般课程转写", []],
  ];
  for (const [priority, reason, keywords] of rules) {
    if (!keywords.length || keywords.some((keyword) => text.includes(keyword))) return { priority, reason };
  }
  return { priority: "P4", reason: "一般课程转写" };
}

function imageMeta(absPath) {
  return {
    titleText: path.basename(absPath, path.extname(absPath)),
    processingStatus: "image-indexed-needs-chinese-ocr",
    gap: OCR_ENABLED ? "图片已进入索引，但中文 OCR 未得到可用文本。" : "图片已进入索引；当前没有可用中文 OCR 语言包。",
  };
}

function extractFile(absPath, ext, id) {
  if (AUDIO_EXTS.has(ext)) return audioTranscript(id) || { text: "", meta: audioMeta(absPath) };
  let staged;
  try {
    staged = stageFile(absPath, id);
    const file = staged.target;
    if (PDF_EXTS.has(ext)) return extractPdf(file);
    if (DOC_EXTS.has(ext)) {
      const textutilText = extractWithTextutil(file);
      const text = textutilText || (ext === ".docx" ? extractDocx(file) : extractStrings(file));
      return { text, meta: { processingStatus: text ? "text-extracted" : "text-empty-or-unreadable" } };
    }
    if (PPT_EXTS.has(ext)) {
      const text = ext === ".pptx" ? extractPptx(file) : extractStrings(file);
      return { text, meta: { processingStatus: text ? "text-extracted" : "text-empty-or-unreadable" } };
    }
    if (SHEET_EXTS.has(ext)) {
      const text = ext === ".xlsx" ? extractXlsx(file) : extractStrings(file);
      return { text, meta: { processingStatus: text ? "text-extracted" : "text-empty-or-unreadable" } };
    }
    if (IMAGE_EXTS.has(ext)) return extractImageOcr(file);
    if (TEXT_EXTS.has(ext)) return { text: fs.readFileSync(file, "utf8"), meta: { processingStatus: "text-extracted" } };
    return { text: extractStrings(file), meta: { processingStatus: "fallback-strings" } };
  } catch (error) {
    return { text: "", meta: { processingStatus: "extract-error", error: String(error) } };
  } finally {
    if (staged?.dir) fs.rmSync(staged.dir, { recursive: true, force: true });
  }
}

function previousManifestById() {
  if (!REUSE_EXTRACTS) return new Map();
  const manifestPath = path.join(DATA_DIR, "manifest.json");
  if (!fs.existsSync(manifestPath)) return new Map();
  try {
    const previous = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return new Map(previous.map((doc) => [doc.id, doc]));
  } catch {
    return new Map();
  }
}

function reusableExtract(previousDoc) {
  if (previousDoc?.kind === "audio") return audioTranscript(previousDoc.id) || null;
  if (!previousDoc?.extractPath) return null;
  const extractPath = path.join(PROJECT_ROOT, previousDoc.extractPath);
  if (!fs.existsSync(extractPath)) return null;
  return {
    text: fs.readFileSync(extractPath, "utf8"),
    meta: {
      processingStatus: previousDoc.processingStatus,
      gap: previousDoc.processingGap,
      pages: previousDoc.pages,
      ocrLanguage: previousDoc.ocrLanguage,
      ocrPages: previousDoc.ocrPages,
      asrModel: previousDoc.asrModel,
      asrDurationMs: previousDoc.asrDurationMs,
      asrGeneratedAt: previousDoc.asrGeneratedAt,
      needsChineseOcr: previousDoc.needsChineseOcr,
      pdfTextExtracted: previousDoc.pdfTextExtracted,
      error: previousDoc.error,
    },
  };
}

function scoreKeywords(text, keywords) {
  let score = 0;
  const hits = [];
  for (const keyword of keywords) {
    const count = text.split(keyword).length - 1;
    if (count > 0) {
      score += count;
      hits.push(keyword);
    }
  }
  return { score, hits: [...new Set(hits)] };
}

function classify(doc) {
  const combined = `${doc.relativePath}\n${doc.title}\n${doc.excerpt}\n${doc.searchText}`;
  const domains = DOMAINS.map((domain) => {
    const { score, hits } = scoreKeywords(combined, domain.keywords);
    return { id: domain.id, label: domain.label, score, hits };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, "zh-Hans-CN"));

  const disciplines = DISCIPLINES.map((discipline) => {
    const { score, hits } = scoreKeywords(combined, discipline.keywords);
    return { code: discipline.code, name: discipline.name, score, hits };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));

  return {
    domains: domains.slice(0, 5),
    disciplines: disciplines.slice(0, 5),
    primaryDomain: domains[0]?.id ?? "uncategorized",
    primaryDiscipline: disciplines[0]?.code ?? "",
  };
}

function fileKind(ext) {
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (PDF_EXTS.has(ext)) return "pdf";
  if (DOC_EXTS.has(ext)) return "word";
  if (PPT_EXTS.has(ext)) return "slides";
  if (SHEET_EXTS.has(ext)) return "sheet";
  return "other";
}

function buildManifest() {
  const previousDocs = previousManifestById();
  const sourceFiles = SOURCE_ROOTS.flatMap((root) => walk(root).filter((item) => item.kind === "file"));
  const docs = [];
  for (const item of sourceFiles) {
    const absPath = item.path;
    const stat = fs.statSync(absPath);
    const relativePath = sourceRelative(absPath);
    const ext = path.extname(absPath).toLowerCase();
    const id = hashText(relativePath);
    const previous = reusableExtract(previousDocs.get(id));
    const { text, meta } = previous || extractFile(absPath, ext, id);
    const cleaned = cleanText(text);
    const title = path.basename(absPath, ext);
    const excerpt = cleaned.slice(0, 1200);
    const extractPath = cleaned ? path.join(EXTRACT_DIR, `${id}.txt`) : "";
    if (cleaned) fs.writeFileSync(extractPath, cleaned, "utf8");
    const doc = {
      id,
      title,
      absolutePath: absPath,
      relativePath,
      ext: ext.replace(/^\./, "") || "none",
      kind: fileKind(ext),
      bytes: stat.size,
      mtime: stat.mtime.toISOString(),
      extractPath: extractPath ? path.relative(PROJECT_ROOT, extractPath) : "",
      textLength: cleaned.length,
      excerpt,
      searchText: `${title} ${relativePath} ${excerpt}`,
      processingStatus: meta.processingStatus || (cleaned ? "text-extracted" : "indexed-only"),
      processingGap: meta.gap || "",
      pages: meta.pages || 0,
      ocrLanguage: meta.ocrLanguage || "",
      ocrPages: meta.ocrPages || 0,
      asrModel: meta.asrModel || "",
      asrDurationMs: meta.asrDurationMs || 0,
      asrGeneratedAt: meta.asrGeneratedAt || "",
      needsChineseOcr: Boolean(meta.needsChineseOcr),
      pdfTextExtracted: Boolean(meta.pdfTextExtracted),
      error: meta.error || "",
    };
    if (doc.kind === "audio") {
      const priority = audioPriority(title, relativePath);
      doc.audioSeries = audioSeries(relativePath);
      doc.audioOrder = audioOrder(title);
      doc.audioNormalizedTitle = normalizedAudioTitle(title);
      doc.asrPriority = priority.priority;
      doc.asrReason = priority.reason;
    }
    Object.assign(doc, classify(doc));
    docs.push(doc);
  }
  return docs;
}

function countBy(items, getter) {
  const counts = {};
  for (const item of items) {
    const key = getter(item) || "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hans-CN")));
}

function numericRange(values) {
  let min = Infinity;
  let max = -Infinity;
  let count = 0;
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (!Number.isFinite(number)) continue;
    if (number < min) min = number;
    if (number > max) max = number;
    count += 1;
  }
  return count ? { min, max } : null;
}

function numericScore(value) {
  if (value === null || value === undefined || value === "") return null;
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}

function hasScoreBelow(record, threshold) {
  const score = numericScore(record.minScore);
  return Number.isFinite(score) && score < threshold;
}

function inferProvinceFromText(text) {
  const value = String(text || "");
  return ALL_PROVINCES.find((province) => value.includes(province)) || "";
}

function inferYearFromText(text) {
  const match = /(20\d{2})/.exec(String(text || ""));
  return match ? Number(match[1]) : null;
}

function inferRankSubjectFromText(text) {
  const value = String(text || "");
  if (/物理|理科|理工/.test(value)) return "物理类";
  if (/历史|文科|文史/.test(value)) return "历史类";
  if (/综合/.test(value)) return "综合";
  return "";
}

function sortedChinese(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "zh-Hans-CN"));
}

function buildRankSourceCoverage(sourceNotes, uniqueRankRecords) {
  const rankSourceNotes = sourceNotes.filter((source) =>
    String(source.quality || "").includes("rank") ||
    /一分一段/.test(source.title || "")
  );
  const parsedSourceIds = new Set(uniqueRankRecords.map((record) => record.sourceId).filter(Boolean));
  const enriched = rankSourceNotes.map((source) => {
    const title = source.title || "";
    const parsedRecords = Number(source.parsedRecords || 0);
    return {
      id: source.id,
      title,
      url: source.url,
      file: source.file,
      quality: source.quality,
      year: Number(source.year) || inferYearFromText(title) || inferYearFromText(source.url) || null,
      province: source.province || inferProvinceFromText(title),
      subjectType: source.subjectType || inferRankSubjectFromText(title),
      parsedRecords,
      tableCount: Number(source.tableCount || 0),
      imageCount: Number(source.imageCount || 0),
      sheetLinkCount: Number(source.sheetLinkCount || 0),
      pdfLinkCount: Number(source.pdfLinkCount || 0),
      isParsed: parsedRecords > 0 || parsedSourceIds.has(source.id),
    };
  });
  const parsedSources = enriched.filter((source) => source.isParsed);
  const queuedSources = enriched.filter((source) => !source.isParsed);
  return {
    sources: enriched.length,
    parsedSources: parsedSources.length,
    queuedSources: queuedSources.length,
    parsedRecords: uniqueRankRecords.length,
    years: [...new Set(enriched.map((source) => source.year).filter(Boolean))].sort((a, b) => b - a),
    provinces: sortedChinese(enriched.map((source) => source.province)),
    subjects: sortedChinese(enriched.map((source) => source.subjectType)),
    parsedProvinces: sortedChinese(parsedSources.map((source) => source.province)),
    queuedProvinces: sortedChinese(queuedSources.map((source) => source.province)),
    parsedYears: [...new Set(parsedSources.map((source) => source.year).filter(Boolean))].sort((a, b) => b - a),
    queuedYears: [...new Set(queuedSources.map((source) => source.year).filter(Boolean))].sort((a, b) => b - a),
    imageQueuedSources: queuedSources.filter((source) => source.imageCount > 0).length,
    sheetQueuedSources: queuedSources.filter((source) => source.sheetLinkCount > 0).length,
    pdfQueuedSources: queuedSources.filter((source) => source.pdfLinkCount > 0).length,
    byYear: [...new Set(enriched.map((source) => source.year).filter(Boolean))]
      .sort((a, b) => b - a)
      .map((year) => {
        const yearSources = enriched.filter((source) => source.year === year);
        const yearParsed = yearSources.filter((source) => source.isParsed);
        const yearQueued = yearSources.filter((source) => !source.isParsed);
        return {
          year,
          sources: yearSources.length,
          parsedSources: yearParsed.length,
          queuedSources: yearQueued.length,
          parsedRecords: uniqueRankRecords.filter((record) => record.year === year).length,
          provinces: sortedChinese(yearSources.map((source) => source.province)),
          parsedProvinces: sortedChinese(yearParsed.map((source) => source.province)),
          queuedProvinces: sortedChinese(yearQueued.map((source) => source.province)),
        };
      }),
    sampleQueuedSources: queuedSources.slice(0, 16).map((source) => ({
      title: source.title,
      province: source.province,
      subjectType: source.subjectType,
      year: source.year,
      imageCount: source.imageCount,
      tableCount: source.tableCount,
      url: source.url,
    })),
  };
}

function buildProvinceReadiness({
  uniqueRecords,
  uniqueRankRecords,
  majorTrendPairs,
  majorTrendSeries3y,
  majorTrendSeries4y,
  rankSourceCoverage,
}) {
  const parsedRankProvinces = new Set(rankSourceCoverage.parsedProvinces || []);
  const queuedRankProvinces = new Set(rankSourceCoverage.queuedProvinces || []);
  const rows = ALL_PROVINCES.map((province) => {
    const provinceRecords = uniqueRecords.filter((record) => record.province === province);
    const scoredProvinceRecords = provinceRecords.filter((record) => record.dataType !== "admission-plan");
    const majorRecords = provinceRecords.filter((record) => record.dataType === "major-admission");
    const institutionRecords = provinceRecords.filter((record) => record.dataType === "institution-admission");
    const vocationalRecords = provinceRecords.filter((record) => record.dataType === "vocational-admission");
    const planRecords = provinceRecords.filter((record) => record.dataType === "admission-plan");
    const partialVocationalRecords = vocationalRecords.filter((record) => String(record.sourceQuality || "").includes("partial"));
    const officialRecords = provinceRecords.filter((record) => String(record.sourceQuality || "").includes("official"));
    const majorWithRank = majorRecords.filter((record) => record.minRankEnd);
    const years = [...new Set(provinceRecords.map((record) => record.year).filter(Boolean))].sort((a, b) => b - a);
    const rankRecords = uniqueRankRecords.filter((record) => record.province === province);
    const officialRankRecords = rankRecords.filter((record) => String(record.sourceQuality || "").includes("official"));
    const officialEvidenceRecords = officialRecords.length + officialRankRecords.length;
    const trend2y = majorTrendPairs.filter((items) => items.some((record) => record.province === province)).length;
    const trend3y = majorTrendSeries3y.filter((items) => items.some((record) => record.province === province)).length;
    const trend4y = majorTrendSeries4y.filter((items) => items.some((record) => record.province === province)).length;
    const subjects = sortedChinese(provinceRecords.map((record) => record.subjectType));
    const scoreParts = {
      major: majorRecords.length ? 18 : 0,
      majorRank: majorWithRank.length >= 100 ? 16 : majorWithRank.length ? 10 : 0,
      institution: institutionRecords.length ? 10 : 0,
      vocational: vocationalRecords.length ? 8 : 0,
      rankConversion: rankRecords.length ? 16 : 0,
      official: officialEvidenceRecords ? 8 : 0,
      years: years.length >= 4 ? 14 : years.length >= 3 ? 10 : years.length >= 2 ? 6 : 0,
      trend: trend4y ? 10 : trend3y ? 8 : trend2y ? 5 : 0,
      breadth: scoredProvinceRecords.length >= 3000 ? 8 : scoredProvinceRecords.length >= 1000 ? 6 : scoredProvinceRecords.length >= 300 ? 3 : 0,
    };
    const readinessScore = Math.min(100, Object.values(scoreParts).reduce((sum, value) => sum + value, 0));
    const missing = [];
    if (!rankRecords.length) {
      missing.push(queuedRankProvinces.has(province) ? "一分一段已采待解析" : "缺可计算一分一段");
    }
    if (!majorWithRank.length) missing.push("专业最低位次薄弱");
    if (!vocationalRecords.length) missing.push("高职专科数据待补");
    else if (partialVocationalRecords.length === vocationalRecords.length) missing.push("高职专科全量待补");
    if (!officialEvidenceRecords) missing.push("省考试院官方附件待补");
    if (years.length < 3) missing.push("历史年份不足三年");
    if (!trend3y) missing.push("三年专业趋势待补");
    const status = readinessScore >= 80 ? "strong" : readinessScore >= 60 ? "usable" : readinessScore >= 40 ? "seed" : "thin";
    const statusLabel = {
      strong: "强证据",
      usable: "可用",
      seed: "种子",
      thin: "待加厚",
    }[status];
    const recommendationUse = {
      strong: "可用于同省同科类强匹配排序，仍需回官方计划和章程复核。",
      usable: "可做本省候选排序，但位次或专业分薄弱项需要人工核验。",
      seed: "只能做本省种子候选和补数提示，不宜输出录取概率。",
      thin: "仅作全国候选参考，应优先补本省考试院和院校官方数据。",
    }[status];
    return {
      province,
      readinessScore,
      status,
      statusLabel,
      recommendationUse,
      records: provinceRecords.length,
      schools: new Set(provinceRecords.map((record) => record.schoolName).filter(Boolean)).size,
      planRecords: planRecords.length,
      planCount: planRecords.reduce((sum, record) => sum + (Number(record.planCount) || 0), 0),
      years,
      subjects,
      dataTypes: countBy(provinceRecords, (record) => record.dataType || "unknown"),
      majorRecords: majorRecords.length,
      majorWithRank: majorWithRank.length,
      institutionRecords: institutionRecords.length,
      vocationalRecords: vocationalRecords.length,
      partialVocationalRecords: partialVocationalRecords.length,
      officialRecords: officialRecords.length,
      officialRankRecords: officialRankRecords.length,
      officialEvidenceRecords,
      rankConversionRecords: rankRecords.length,
      rankParsedSource: parsedRankProvinces.has(province),
      rankQueuedSource: queuedRankProvinces.has(province),
      trend2y,
      trend3y,
      trend4y,
      missing,
    };
  }).sort((a, b) => b.readinessScore - a.readinessScore || b.records - a.records || a.province.localeCompare(b.province, "zh-Hans-CN"));
  return {
    provinces: rows.length,
    strong: rows.filter((row) => row.status === "strong").length,
    usable: rows.filter((row) => row.status === "usable").length,
    seed: rows.filter((row) => row.status === "seed").length,
    thin: rows.filter((row) => row.status === "thin").length,
    rankReady: rows.filter((row) => row.rankConversionRecords > 0).length,
    vocationalReady: rows.filter((row) => row.vocationalRecords > 0).length,
    trend3yReady: rows.filter((row) => row.trend3y > 0).length,
    trend4yReady: rows.filter((row) => row.trend4y > 0).length,
    weakest: [...rows].sort((a, b) => a.readinessScore - b.readinessScore || a.records - b.records).slice(0, 8),
    rows,
  };
}

function sumScores(docs, field, labelGetter) {
  const scores = new Map();
  for (const doc of docs) {
    for (const item of doc[field] ?? []) {
      const key = labelGetter(item);
      const current = scores.get(key) ?? { key, score: 0, files: 0, hits: new Set() };
      current.score += item.score;
      current.files += 1;
      for (const hit of item.hits ?? []) current.hits.add(hit);
      scores.set(key, current);
    }
  }
  return [...scores.values()]
    .map((item) => ({ key: item.key, score: item.score, files: item.files, hits: [...item.hits].slice(0, 12) }))
    .sort((a, b) => b.score - a.score || b.files - a.files || a.key.localeCompare(b.key, "zh-Hans-CN"));
}

function matchedDocsForLens(docs, lens) {
  const keywords = lens.keywords;
  return docs.map((doc) => {
    const text = `${doc.relativePath}\n${doc.title}\n${doc.excerpt}\n${doc.searchText}`;
    const base = keywords.length ? scoreKeywords(text, keywords) : { score: 1, hits: [] };
    return { doc, score: base.score, hits: base.hits };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || b.doc.textLength - a.doc.textLength);
}

function roundNotes(id) {
  const notes = {
    "01": [
      "资料被划为可抽取文本、中文 OCR、音频 ASR、表格/课件四层。",
      "音频课程已通过本地 whisper.cpp 与临时 ffmpeg 转码完成全文转写，可与文档、课件、表格一起参与知识整合。",
    ],
    "02": [
      "志愿系统必须先讲清投档规则，再讲专业和院校偏好；退档、调剂、招生章程是风险控制核心。",
      "专业级差、平行志愿、顺序志愿应作为独立规则卡片，避免被混在泛泛经验里。",
    ],
    "03": [
      "新老高考逻辑不能合并讲：新高考要突出选科、院校专业组和组内调剂，老高考更偏院校+专业顺序。",
      "网站把新高考1、新高考2、老高考材料分别保留来源，避免跨省误用。",
    ],
    "04": [
      "专业认知按门类组织，07理学、08工学、02经济学、12管理学等可作为第一层导航。",
      "本地资料中有本科专业目录和专科专业目录，网站应同时保留本科门类和高职专科大类入口。",
    ],
    "05": [
      "07理学不是简单的'理科生可报'，而是基础科学和方法训练；化学、生物、地质、心理学等材料要归入理学专题。",
      "理学决策要看深造意愿、实验/数学基础、转师范/工科/数据方向的通道。",
    ],
    "06": [
      "08工学按产业链理解更有效：计算机、机械、电气、土木、材料等不只比较冷热，还要看学校平台和城市产业。",
      "材料、土木等容易被单一就业舆论影响，网站应放入'行业周期与风险'标签。",
    ],
    "07": [
      "经济学和管理学要拆开：金融/经济偏经济学，会计/审计/财务管理偏管理学，但就业上常被家长合并讨论。",
      "商科类必须结合城市、实习、学校平台和证书，不宜只按专业名称排序。",
    ],
    "08": [
      "师范、法学、文学、历史、哲学等方向更需要稳定兴趣和长期路径判断。",
      "公安警校与普通法学不同，应放入特殊路径和体检政审双标签。",
    ],
    "09": [
      "医学、军校、警校、定向士官都属于强约束路径，必须把体检、学制、服务期、政审和地域限制放在前面。",
      "医学本博连读不能只看光环，要同时解释学制、规培和院校医院资源。",
    ],
    "10": [
      "院校层次判断包括 985/211/双一流/C9，也包括改名、合并、分校、中外合作和港澳院校。",
      "校名变化和合并历史容易影响判断，应该作为院校风险卡片而不是冷知识。",
    ],
    "11": [
      "城市选择既影响见识、实习和就业，也影响家庭成本；它是志愿组合变量，不是院校排名的附属项。",
      "区域高校介绍适合进入城市专题，配合院校层次和专业方向交叉过滤。",
    ],
    "12": [
      "特殊招生路径都需要独立条件表：资格、报名窗口、院校范围、协议/服务期和退出成本。",
      "综合评价、专项计划、公费师范、定向士官、港澳路径不能混在普通批策略里。",
    ],
    "13": [
      "体检限报是硬约束，色觉异常、高度近视、军警体检体测要在专业推荐前过滤。",
      "退档和调剂是软硬结合风险，网站应把风险项转成填报前检查清单。",
    ],
    "14": [
      "行业就业材料强调'行业规划决定志愿填报'，这可以成为专业选择的现实层。",
      "行业热度应与个人能力、学校平台、城市资源和周期风险一起看。",
    ],
    "15": [
      "高一高二高三家长材料提示：志愿填报不是出分后才开始，选科、专业认知和院校层次理解应前置。",
      "网站可按时间线输出家长任务表：认知、数据、估分、方案、复核。",
    ],
    "16": [
      "最终模型用'分数位次安全边界 + 专业适配 + 院校平台 + 城市资源 + 风险限制'五轴评分。",
      "冲稳保只是外壳，核心是每个志愿单元的录取概率、调剂风险和可接受度。",
    ],
    "17": [
      "咨询和讲座资料能沉淀用户沟通问题：家长最关心专业出路、院校层次、城市、风险和分数价值最大化。",
      "运营话术不直接进入学生决策建议，但可以帮助网站组织 FAQ 和问诊表。",
    ],
    "18": [
      "高频风险包括：误解平行志愿、忽略招生章程、服从调剂不可接受、体检限报、校区/分校误判、热门专业跟风。",
      "每个风险都要在网站里对应一个'填报前确认'动作。",
    ],
    "19": [
      "数据库和专业目录是工具，不是结论；往年录取必须结合招生计划、批次、选科和省份变化。",
      "第四轮学科评估可作为学科实力参考，但不能替代当年招生规则和个人适配。",
    ],
    "20": [
      "最终知识库以门类/规则/路径/风险/经验五条主线组织，文件库作为证据底座。",
      "每个页面都保留来源文件列表，方便回到原资料核对。",
    ],
    "21": [
      "本轮审计覆盖所有索引文件；图片和纯图 PDF 已补中文 OCR，低清晰度扫描件仍保留人工复核提醒。",
      "124 个音频均已完成完整离线 ASR 转写，当前没有音频待转写缺口。",
    ],
    "22": [
      "省份、批次和官方口径是所有建议的最后闸门；网站里的经验只能先做方案草案，不能替代当年考试院规则。",
      "招生计划、院校代码、专业代码、选科要求和招生章程应在正式填报前形成逐项核验表。",
    ],
    "23": [
      "高中科目与大学学科的关联不能只按'文理'判断；选科、专业组和组内调剂会直接改变可报范围。",
      "物理、化学、生物、历史等选科约束应先过滤，再讨论院校层次、专业冷热和城市偏好。",
    ],
    "24": [
      "专业判断要回到课程结构和能力画像：数学、实验、英语、表达、实践、证书等要求决定长期适配。",
      "同名专业在不同学院和学校可能课程差异很大，网站后续应保留'看培养方案'的提示。",
    ],
    "25": [
      "热门/冷门不是稳定标签，行业周期、体制内外、垄断稀缺和城市资源会一起改变专业价值。",
      "材料、土木、金融、计算机等方向要用周期和能力门槛解释，不能只按舆论热度排序。",
    ],
    "26": [
      "校名、校区、分校、合并历史和中外合作办学是院校判断的高频误区，必须从普通院校层次里拆出来。",
      "合作办学要同时看学费、培养地点、毕业证书、转专业规则和家庭预算承受度。",
    ],
    "27": [
      "院校实力证据链要分层：985/211/双一流是平台标签，学科评估、博士点和专业平台更接近具体专业实力。",
      "第四轮学科评估、专业目录和院校名单可做证据底座，但不能直接推出当年录取概率。",
    ],
    "28": [
      "城市不是背景项，而是实习、行业、视野、成本和毕业留用机会的组合变量。",
      "上海、武汉、昆明、长春、吉林、内蒙古、港澳等区域材料适合与院校层次和专业方向交叉展示。",
    ],
    "29": [
      "家庭预算、心理承受和亲子沟通会影响方案可执行性；可接受的调剂、城市和学费边界要提前谈清。",
      "家长准备不是替孩子做选择，而是帮孩子完成信息核验、风险识别和备选方案维护。",
    ],
    "30": [
      "分数位次和往年录取只能做概率线索，必须结合当年招生计划、批次变化、选科要求和院校专业组变化。",
      "数据库资料的正确用法是校验区间和风险，而不是把历史最低分机械外推成今年结论。",
    ],
    "31": [
      "冲稳保的核心不是数量比例，而是每个志愿单元的录取概率、调剂可接受度和兜底可靠性。",
      "方案层应同时保留冲刺项、稳妥项、保底项和绝不接受项，避免只追求分数价值最大化。",
    ],
    "32": [
      "退档、调剂和招生章程是复盘风险的第一层；进档不等于进入想读专业。",
      "专业级差、分数优先、志愿优先和服从调剂要转成填报前可勾选的核验动作。",
    ],
    "33": [
      "特殊路径要按资格、时间窗口、协议义务和退出成本处理，不能与普通批次建议混写。",
      "综评、专项、公费师范、军警、港澳和自主招生都应保留'适用人群 + 硬条件 + 风险边界'。",
    ],
    "34": [
      "医学、师范、法学、公安警校等长周期路径，关键不是短期热度，而是投入年限、资格证、体检政审和就业约束。",
      "这些方向适合放在强约束路径中，先核验限制条件，再比较学校和城市。",
    ],
    "35": [
      "理学与工学要同时看基础训练和应用出口；数学、物理、化学、生物、计算机、数据方向存在交叉通道。",
      "新兴交叉专业不能只看名称，要看归属学院、课程结构、师资平台和真实就业/深造出口。",
    ],
    "36": [
      "经管文法商科方向要拆开现实层：金融、会计、审计、法学、新闻、国际商务对城市和平台依赖不同。",
      "这些专业的风险常来自名称相近但出口不同，网站应提示证书、实习和行业门槛。",
    ],
    "37": [
      "高职专科和本科不应混成同一套判断；职业教育更看技能路径、区域产业、升学通道和双高建设。",
      "专升本、就业导向和技能证书应成为专科路径的独立解释层。",
    ],
    "38": [
      "低分高就、捡漏和另辟蹊径要拆成真实机会与宣传误区：港澳、中外合作、分校和冷门方向成本不同。",
      "所谓'低分上名校'必须同时核验专业、学费、证书、校区、培养方式和后续出口。",
    ],
    "39": [
      "高三寒假、期末后和最后半学期是方案预演期：认知补课、估分区间、城市专业边界都要提前完成。",
      "临门一脚最重要的是减少临场信息噪声，把已确认的风险清单和备选方案稳定下来。",
    ],
    "40": [
      "答疑、名词解释、常识和咨询话术可以转成家长问诊库，帮助快速定位规则、专业、院校或风险问题。",
      "运营材料不直接作为决策建议，但能暴露家长高频误解，适合做 FAQ 和首轮问诊入口。",
    ],
    "41": [
      "二次总审把新增 20 轮归并为推荐器骨架：官方核验、选科过滤、专业适配、院校证据、城市资源、风险兜底。",
      "下一步若做智能推荐，应先让用户输入省份、科类/选科、位次、预算、专业偏好、城市边界和不可接受项。",
    ],
    "42": [
      "推荐器冷启动字段应分必填和偏好：省份/批次/选科/位次是硬输入，预算、城市、专业偏好和不可接受项是软边界。",
      "资料里的规则、专业、城市、家长沟通内容都可以映射到用户画像字段，避免只让用户填一个分数。",
    ],
    "43": [
      "硬过滤规则必须早于推荐排序：选科不符、体检限报、语种限制、批次不符、协议资格不满足的项目应直接剔除。",
      "军警、医学、师范、专项和港澳等路径要单独维护资格与服务期，不能靠通用分数模型处理。",
    ],
    "44": [
      "软评分不应固定一套权重；专业优先、院校优先、城市优先和家庭稳妥型应对应不同权重模板。",
      "分数位次安全边界、专业适配、院校平台、城市资源、就业现实和风险承受度可组成可解释评分。",
    ],
    "45": [
      "专业适配要看兴趣稳定性、课程结构、能力门槛、深造意愿和真实职业出口，而不是只看专业名称。",
      "07理学、08工学、经管商科、医学、师范等方向都应有不同适配问法和排雷点。",
    ],
    "46": [
      "院校平台应拆成学校层次、学科实力、培养资源、校区位置、行业认可和区域影响力。",
      "985/211/双一流是入口标签，学科评估、博士点、专业平台和城市资源才是具体志愿单元的解释证据。",
    ],
    "47": [
      "城市产业映射应解释为什么同一专业在不同城市价值不同：实习机会、产业集群、毕业留用和生活成本都会改变选择。",
      "地域机会不是只看大城市；省内就业、家庭距离、区域高校资源和未来迁移意愿也要进入方案。",
    ],
    "48": [
      "风险红线要显式输入：不能接受的专业、不能接受的城市、不能接受的学费、不能接受的调剂都应先声明。",
      "退档、调剂、校区、合作办学、体检限报和长学制成本应从普通风险提示升级为红线系统。",
    ],
    "49": [
      "建议背后的证据要分级：官方章程和考试院规则最高，专业目录/学科评估次之，讲座经验和咨询话术只能作辅助。",
      "不同置信度的证据不应在界面上混成同一种来源，后续可用标签提示用户哪些必须回官网复核。",
    ],
    "50": [
      "来源追溯层要把推荐理由连回文件、音频转写、OCR 文本和整合轮次，方便用户回看证据。",
      "每个志愿单元应能解释'来自哪些资料、对应哪条规则、还有哪些官方核验动作'。",
    ],
    "51": [
      "交互问诊应按顺序推进：先确认省份批次和硬约束，再确认偏好与红线，最后生成方案和复核清单。",
      "家长常见问题可以作为入口，但系统要把模糊问题转成可计算字段和可核验动作。",
    ],
    "52": [
      "方案模板应包含冲、稳、保、兜底、备选和排除项，而不是只输出一个学校列表。",
      "每个方案都应附带调剂接受度、风险解释、官方核验项和家长/学生确认项。",
    ],
    "53": [
      "志愿单元解释器要同时说明推荐理由和排除理由；被排除的好学校也要说明是选科、风险、预算还是专业不适配。",
      "可解释性会降低家长临场焦虑，让方案从'相信排名'变成'理解取舍'。",
    ],
    "54": [
      "家长协同面板应把家长任务拆成资料核验、预算确认、风险确认、沟通记录和方案签字确认。",
      "孩子偏好和家庭边界需要一起显示，否则最后容易在城市、专业、调剂和学费上反复摇摆。",
    ],
    "55": [
      "政策变化预警应跟踪年份、省份、招生计划、院校专业组、章程和专业目录变化，避免旧数据直接套用。",
      "网站后续应把'必须当年复核'的内容从诚实边界升级为具体预警清单。",
    ],
    "56": [
      "OCR/ASR 已全量完成，但识别误差仍是质量边界；重要规则和专业结论应保留人工复核入口。",
      "旧版 Office 抽取、低清扫描和音频转写中的错字不影响索引覆盖，但会影响可直接引用程度。",
    ],
    "57": [
      "本科和高职专科应形成双路径推荐：本科看学科平台和深造，专科看技能、区域产业、双高和专升本通道。",
      "高职专科不是低配本科，推荐模型要承认它的职业路径和评价指标不同。",
    ],
    "58": [
      "特殊成本收益应单列：中外合作和港澳看学费/证书/培养地点，医学看长学制和规培，军警师范看协议义务。",
      "这些路径不能只用录取分衡量，必须把未来约束和家庭承受能力一并解释。",
    ],
    "59": [
      "冷启动问卷应先问会改变可报范围的问题，再问偏好问题；先过滤，再推荐。",
      "最少字段应包含省份、选科/科类、位次、预算、城市边界、专业倾向、红线和特殊路径意愿。",
    ],
    "60": [
      "升级版闭环是：用户输入 -> 硬过滤 -> 软评分 -> 方案生成 -> 解释追溯 -> 官方复核 -> 家庭确认。",
      "每一环都应有失败出口，例如资料缺失、政策需复核、风险不可接受或家庭边界冲突。",
    ],
    "61": [
      "全面升级总审把 61 轮沉淀压成实施蓝图：资料库负责证据，规则引擎负责过滤，评分器负责排序，解释器负责沟通。",
      "下一阶段可以从本地静态站升级为交互式志愿工作台，但仍要保留官方核验和人工复核边界。",
    ],
    "62": [
      "可靠推荐不能只输出结论，必须同时展示评分公式、命中证据、置信度和需要回官方核验的项目。",
      "当前本地模型适合做院校池和方向组合排序，不直接承诺当年录取概率；录取概率需要本省当年计划、投档线和一分一段复核。",
    ],
    "63": [
      "孩子画像至少要区分稳健型、冲刺型、专业兴趣强、城市资源型、预算敏感、学术深造型和就业导向型。",
      "同一个分数在不同画像下排序会不同：稳健型重兜底，冲刺型允许高平台冲刺，专业兴趣强优先课程和长期适配。",
    ],
    "64": [
      "分数只是入口，位次才更接近跨年比较口径；没有位次时模型必须降低可信度并提示补充一分一段。",
      "高位、上位、中位、基础四档分别对应平台优先、优势城市/专业平衡、稳妥专业池和职业/升学双路径。",
    ],
    "65": [
      "院校候选池先按平台和路径分层：985/211/双一流/C9、强区域高校、港澳、师范、医学军警、高职双高等。",
      "院校池只给方向和层级，不替代具体学校当年招生计划；正式方案要按省份批次和专业组逐项筛。",
    ],
    "66": [
      "专业候选池应以门类为第一层，07理学、08工学、经管商科、医学、师范、法学和高职技能路径各用不同评价指标。",
      "专业推荐必须说明课程门槛、能力要求、深造/就业出口和调剂可接受度，避免只按热门名称推荐。",
    ],
    "67": [
      "志愿单元不是单独的学校或专业，而是院校平台、专业方向、城市资源、家庭边界和风险等级的组合。",
      "同一个专业在不同城市和院校平台下价值不同，模型要把城市产业和实习机会作为可解释加分项。",
    ],
    "68": [
      "冲稳保分段应由风险承受度驱动：冲刺项看平台上限，稳妥项看专业和城市匹配，保底项看真实愿读度。",
      "保底不是低分学校清单，而是孩子和家庭都能接受的可执行兜底方案。",
    ],
    "69": [
      "证据链至少包括来源文件标题、命中主题/门类、整合轮次和是否来自官方/目录/音频经验等类型。",
      "置信度应随证据数量、输入完整度和官方可复核程度变化，不能让经验材料和官方规则拥有同等权重。",
    ],
    "70": [
      "推荐理由模板应固定为：硬条件匹配、分数位次策略、专业适配、院校平台、城市预算、风险控制和证据来源。",
      "理由越固定，越方便家长比较多个方案，也越能发现缺少位次、省份或官方计划时的薄弱点。",
    ],
    "71": [
      "排除理由和推荐理由同样重要：选科不符、体检限报、预算过高、调剂不可接受、证据不足都应明确写出。",
      "被排除的高平台院校不代表不好，而是与当前孩子画像、家庭边界或当年可报条件不匹配。",
    ],
    "72": [
      "省份和年份是最终闸门；任何模型输出都要回到当年考试院、招生计划、院校代码、专业代码和招生章程核验。",
      "网站应把官方复核从一句提醒升级为每张推荐卡片上的待办清单。",
    ],
    "73": [
      "家庭预算、学费、城市距离和不可接受项会直接改变可执行性，应作为模型红线而不是事后备注。",
      "预算敏感型家庭要谨慎处理港澳、中外合作、长学制医学和高生活成本城市。",
    ],
    "74": [
      "综评、专项、公费师范、军警、港澳、中外合作和定向士官都有独立资格、成本和退出约束，必须单独建模。",
      "特殊路径适合做机会提示，但不应混入普通批次排序直接当成录取捷径。",
    ],
    "75": [
      "学习风格匹配要看课程门槛：理学重数学/实验和深造，工学重工程实践，经管法文更依赖表达、证书和城市资源。",
      "人格画像不是贴标签，而是帮助判断长期能否承受课程、行业周期和就业路径。",
    ],
    "76": [
      "可解释评分公式采用硬匹配、分数位次策略、专业适配、城市预算和证据充分度加权，再扣除红线风险。",
      "公式公开能让用户知道推荐为何排序，也便于后续加入当年招生计划和投档数据后继续升级。",
    ],
    "77": [
      "A- 表示输入完整且本地证据充足但仍需官方核验，B 表示证据可用但缺少关键输入或官方数据，C 表示探索性建议。",
      "没有位次、省份、科类/选科或证据来源太少时，模型必须自动降级可信度。",
    ],
    "78": [
      "人工复核清单包括招生章程、招生计划、专业组/专业代码、调剂规则、体检限报、学费、校区和培养地点。",
      "模型输出后的人工确认不应被视为麻烦，而是把风险从临场焦虑变成可勾选动作。",
    ],
    "79": [
      "方案对比不只比较总分，还要比较冲稳保定位、专业方向、城市资源、证据强度、预算风险和家庭可执行性。",
      "排序结果应显示每个院校池为什么排在前面，以及为什么有些看似更好的方向被放后。",
    ],
    "80": [
      "交互式推荐工作台要让家长输入孩子类型、分数位次、省份、科类/选科、专业方向、城市偏好、预算和红线。",
      "输出应包含推荐院校池/方向、模型分、理由、证据来源、可信度和官方复核清单，形成可讨论而不是黑箱的结果。",
    ],
    "81": [
      "81 轮总审把资料吸收、专业分类、经验现状和推荐模型汇成一个本地闭环：先问诊，再排序，再解释，再复核。",
      "可靠性来自透明、可追溯和可复核；在接入当年官方投档与计划数据前，网站定位为高质量决策助手而非录取承诺器。",
    ],
    "82": [
      "具体院校选择必须先看录取分数据层：院校/专业组投档分用于判断能否进档，专业录取分用于判断能否进目标专业。",
      "如果没有结构化分数表，网站只能给候选院校和核验动作，不能把候选排序包装成真正的录取安全排序。",
    ],
    "83": [
      "本地资料包含全国高校名单、港澳学校专业汇总、军校/医学/综评材料和区域高校讲座，可作为院校候选来源。",
      "这些名单材料解决'有哪些学校可看'，但不等于拥有当年本省录取分；名单证据和分数证据必须分开显示。",
    ],
    "84": [
      "最佳院校排序应分两阶段：先用院校/专业录取分和位次做硬筛，再用画像、专业、城市、预算和证据做软排序。",
      "没有分数数据时，权重必须自动降级，结果只能标为'待分数核验候选'。",
    ],
    "85": [
      "学校层级和专业强度不能混为一谈；高平台学校的弱专业、普通平台的强专业都需要专业录取分和培养方案共同核验。",
      "专业录取分往往比院校投档线更能反映目标专业竞争强度，尤其在组内调剂或校内专业录取规则复杂时。",
    ],
    "86": [
      "具体学校排序要看城市资源和生活成本，但城市加分不能替代录取分安全边界。",
      "上海、武汉、昆明、吉林、长春、内蒙古和港澳材料适合作为城市/区域证据，再叠加分数表核验。",
    ],
    "87": [
      "首选、稳妥、备选标签必须来自分数位次安全边界；没有录取分时只能叫首选核验、稳妥核验、备选核验。",
      "冲稳保的底层不是情绪判断，而是同省同科类同批次的位次区间和近年趋势。",
    ],
    "88": [
      "同分不同孩子会出现不同院校路径，但分数数据仍是第一道门槛；画像只负责在可达候选中排序。",
      "稳健型更看稳妥和保底分差，冲刺型可保留上探学校，专业兴趣强则要优先核验专业录取分。",
    ],
    "89": [
      "具体理由生成必须拆成'分数依据'和'适配依据'：前者来自院校/专业录取分，后者来自画像、专业、城市和资料证据。",
      "当前没有结构化分数表时，理由里必须明确写'分数依据待导入/待官方核验'。",
    ],
    "90": [
      "排除高名气学校时要说明是分数差距、专业不可达、预算红线、体检限报、调剂不可接受还是证据不足。",
      "不能因为学校名气大就推荐，也不能因为没有分数表就把风险隐藏。",
    ],
    "91": [
      "每个具体院校建议都需要回查院校代码、专业组、专业代码、招生计划、招生章程和近年专业录取分。",
      "学校名单和专业目录只能辅助定位，最终仍要用当年官方计划和学校本科招生网数据核验。",
    ],
    "92": [
      "当年投档线和专业录取分缺失时，模型只能输出候选层，不得输出录取概率或'稳录'结论。",
      "近年数据也要看计划变化、选科变化、专业组变化和大小年趋势，不能机械套用最低分。",
    ],
    "93": [
      "数据缺口会降低可信度：缺位次、缺省份、缺科类、缺专业录取分、缺招生计划都要在结果卡片里暴露。",
      "可信度最高的结果应同时具备完整输入、结构化录取分、来源证据和官方复核动作。",
    ],
    "94": [
      "新高考模式下，院校专业组和组内调剂会改变专业可达性；只看院校最低投档线会低估专业风险。",
      "专业组模式必须把组内可调剂专业、选科要求和专业最低分一起核验。",
    ],
    "95": [
      "没有当年官方数据时，系统必须明确禁止'录取概率、保录、必中、稳上'等表达。",
      "可靠模型的价值是缩小候选范围、生成核验清单和解释取舍，而不是替代官方录取数据。",
    ],
    "96": [
      "每个院校建议后要附带可操作动作：查院校/专业组投档线、查专业录取分、看招生计划、读章程、问调剂。",
      "这些动作比泛泛提醒更适合家长执行，也能把模型输出变成真实填报前的工作单。",
    ],
    "97": [
      "院校对比表应把模型推荐分、分数数据状态、首选理由、主要风险、证据来源和待查项目放在同一张卡。",
      "当分数数据缺失时，对比表必须把'分数待核验'列为醒目状态。",
    ],
    "98": [
      "家庭会谈输出应先讨论分数是否可达，再讨论孩子是否适合，最后讨论城市、预算和调剂底线。",
      "孩子和家长如果只看学校名气，很容易忽略目标专业分数和调剂风险。",
    ],
    "99": [
      "模型审计日志要记录输入完整度、是否有结构化录取分、权重使用、扣分项、证据数量和降级原因。",
      "这样用户看到的不只是结论，而是为什么模型不能或能够给出更强建议。",
    ],
    "100": [
      "终版推荐工作台应把具体院校建议、录取分数据状态、院校池、理由、风险、证据和复核清单统一展示。",
      "没有结构化分数表前，页面第一屏就要提示'当前为候选核验模型'。",
    ],
    "101": [
      "101 轮总审形成新的底线：录取分数据层优先，画像适配第二，经验证据辅助，官方复核收口。",
      "下一步若要真正自动选择最佳院校，应导入同省同科类近三年院校/专业录取分、最低位次、招生计划和专业组数据。",
    ],
    "102": [
      "全国化的第一原则是省份、科类、年份三维隔离；江西样例不能外推到其他省份。",
      "网站输入层必须允许任意省份先进入候选核验模型，再按该省数据覆盖决定可信度。",
    ],
    "103": [
      "同分不同省没有可比性，位次也只能在同省同科类同年份中使用。",
      "跨年趋势必须先做同位分或位次换算，不能把上一年最低分机械套到今年。",
    ],
    "104": [
      "院校投档线、专业组线和专业录取分是三种证据；专业推荐优先使用专业录取分。",
      "只有院校投档线时，结论只能停留在院校候选和专业组核验，不可断言目标专业可达。",
    ],
    "105": [
      "专业门类归档要服务推荐解释：07 理学偏基础与深造，08 工学偏工程训练和产业出口。",
      "数字媒体技术应按 08 工学处理，和艺术类数字媒体艺术区分。",
    ],
    "106": [
      "任意孩子画像应拆为硬信息、软偏好和红线：分数位次是入口，兴趣能力负责排序。",
      "单科强弱会改变专业适配，例如计算机科班更看数学、抽象能力和持续编程训练。",
    ],
    "107": [
      "全国候选池要先按省内可用数据筛，再按院校平台、专业强度、城市资源和风险排序。",
      "没有本省数据的学校只能作为待查候选，不进入强推荐结论。",
    ],
    "108": [
      "专业前景不能只看热度，要同时看课程难度、行业周期、就业门槛和个人适配。",
      "数字媒体技术适合技术+内容交叉型学生，但若目标是纯软件岗位，计算机科班通常更稳。",
    ],
    "109": [
      "计算机科学与技术是更标准的科班入口，软件工程、网安、数据、AI 和数媒各有侧重。",
      "推荐时应说明目标岗位：算法/系统更偏计科，应用开发可计科/软件，交互内容技术可数媒。",
    ],
    "110": [
      "冲稳保分层必须先看录取分/位次安全边界，再看孩子画像和偏好。",
      "全国数据不全时，页面要把'冲稳保'降级为'冲稳保核验'，避免制造录取确定性。",
    ],
    "111": [
      "官方证据优先级固定为省考试院、学校招生网、招生章程、当年计划，第三方只做种子。",
      "第三方数据可帮助快速扩库，但每条建议都要保留来源和复核动作。",
    ],
    "112": [
      "自动导入必须按表头取字段，并扫描最低分大于最高分、伪省份、小标题误读等异常。",
      "缺最低位次的记录只能做分数候选，不能和有位次记录同等置信度。",
    ],
    "113": [
      "新高考专业组模式下，专业可达性受选科、组内调剂和组内专业构成共同影响。",
      "全国模型必须保留专业组字段，不能只按院校名和最低分排序。",
    ],
    "114": [
      "缺院校分、缺专业分、缺位次、缺计划数时，模型要明确说出缺口。",
      "数据不足的正确产物是候选清单和核验任务，不是录取概率。",
    ],
    "115": [
      "推荐理由模板应固定为：分数证据、专业适配、院校平台、城市资源、风险控制和下一步核验。",
      "这能让任意省份的解释保持同一结构，方便家长和学生比较。",
    ],
    "116": [
      "排除理由模板应固定为：分数不可达、专业不适配、红线冲突、调剂风险、证据不足。",
      "清楚排除比堆砌候选更重要，能减少高名气学校误选。",
    ],
    "117": [
      "一分一段和同位分是下一阶段全国化的关键接口，用来处理跨年分数口径。",
      "没有同位分前，跨年判断必须降低可信度。",
    ],
    "118": [
      "覆盖仪表盘要显示省份数、年份、院校数、专业记录、院校投档记录和专业组记录。",
      "覆盖率本身就是可信度输入；未覆盖省份不能被静默当作已覆盖。",
    ],
    "119": [
      "人机协同流程应是模型给候选和理由，人核官方计划、章程、专业组、学费、体检和调剂。",
      "最终志愿表必须由家庭确认红线和孩子接受度后再定。",
    ],
    "120": [
      "网站已从单个江西考生样例推进为全国候选系统，但全量官方数据仍需继续导入。",
      "全国适用的含义是输入和模型通用，不是每个省每个学校都已完成官方数据闭环。",
    ],
    "121": [
      "120 轮后的可靠边界：结构化录取数据优先、全国输入通用、证据等级可见、缺口自动降级。",
      "下一步重点是批量接入省考试院投档表、院校专业录取分和一分一段表。",
    ],
  };
  return notes[id] ?? [];
}

function buildRounds(docs) {
  const allIdsHash = hashText(docs.map((doc) => doc.id).sort().join("\n"), 24);
  const rounds = [];
  for (const [id, title, purpose, keywords] of ROUND_LENSES) {
    const lens = { id, title, purpose, keywords };
    const matched = matchedDocsForLens(docs, lens);
    const round = {
      id,
      title,
      purpose,
      generatedAt: new Date().toISOString(),
      coverage: {
        totalFilesSeen: docs.length,
        allFileIdsHash: allIdsHash,
        textExtractedFiles: docs.filter((doc) => doc.textLength > 0).length,
        indexedOnlyFiles: docs.filter((doc) => doc.textLength === 0).length,
        matchedFilesForLens: matched.length,
      },
      topSources: matched.slice(0, 12).map((item) => ({
        id: item.doc.id,
        title: item.doc.title,
        relativePath: item.doc.relativePath,
        kind: item.doc.kind,
        score: item.score,
        hits: item.hits,
        processingStatus: item.doc.processingStatus,
      })),
      domainScores: sumScores(docs, "domains", (item) => item.label).slice(0, 8),
      disciplineScores: sumScores(docs, "disciplines", (item) => `${item.code} ${item.name}`).slice(0, 10),
      integratedNotes: roundNotes(id),
    };
    fs.writeFileSync(path.join(ROUND_DIR, `round-${id}.json`), JSON.stringify(round, null, 2), "utf8");
    rounds.push(round);
  }
  return rounds;
}

function buildStrategyFramework(docs) {
  const sourceHits = (keywords) => matchedDocsForLens(docs, { keywords }).slice(0, 8).map((item) => item.doc.id);
  return [
    {
      id: "rule-first",
      title: "先规则，后偏好",
      body: "先判断省份批次、投档方式、招生章程、专业录取规则、调剂和退档风险，再谈学校、专业、城市的取舍。",
      sourceIds: sourceHits(["投档", "招生章程", "录取规则", "退档", "调剂"]),
    },
    {
      id: "five-axis",
      title: "五轴志愿模型",
      body: "每个志愿单元用分数位次安全边界、专业适配、院校平台、城市资源、风险限制五轴评价，避免只按排名或热门做单点决策。",
      sourceIds: sourceHits(["位次", "专业", "大学", "城市", "风险"]),
    },
    {
      id: "major-taxonomy",
      title: "按门类建立专业认知",
      body: "以 01-14 门类组织专业理解，重点展开 07理学、08工学、02经济学、12管理学、10医学和特殊军警路径。",
      sourceIds: sourceHits(["专业目录", "理学", "工学", "医学", "金融"]),
    },
    {
      id: "constraints-before-recommendation",
      title: "硬约束先过滤",
      body: "色觉、近视、军警体检、选科、协议服务期、招生省份等硬约束要先过滤，再进入冲稳保组合。",
      sourceIds: sourceHits(["色觉", "近视", "体检", "选科", "定向士官"]),
    },
    {
      id: "city-school-major",
      title: "专业-院校-城市组合",
      body: "专业决定能力方向，院校决定平台和圈层，城市影响实习、产业和就业；三者要组合，不要把任何一项绝对化。",
      sourceIds: sourceHits(["专业大学与城市", "城市", "院校", "大学", "如何挑大学选专业"]),
    },
    {
      id: "timeline",
      title: "把志愿准备前置",
      body: "高一高二建立专业与选科认知，高三上完成院校和专业池，高考后用位次、招生计划和风险表做最终方案。",
      sourceIds: sourceHits(["高一", "高二", "高三", "寒假", "家长"]),
    },
  ];
}

function buildRiskChecklist() {
  return [
    ["parallel-rule", "是否确认本省本批次是平行志愿、顺序志愿还是其他模式"],
    ["major-rule", "是否读过目标院校招生章程中的专业录取规则"],
    ["adjustment", "是否能接受组内/校内调剂后的最低可接受专业"],
    ["withdrawal", "是否存在不服从调剂、单科、体检、外语语种等退档风险"],
    ["health", "色觉、近视、身高、体测、军警体检是否逐项核对"],
    ["campus", "校区、分校、中外合作、学费、培养地点是否确认"],
    ["plan-change", "今年招生计划和往年计划是否有明显变化"],
    ["ranking", "位次换算是否用同省、同科类/选科、同批次口径"],
    ["special-path", "专项、综评、公费师范、定向士官等协议和资格是否确认"],
    ["bottom-line", "每个保底志愿是否真的愿意就读"],
  ].map(([id, text]) => ({ id, text }));
}

function buildProgress(label) {
  if (process.env.BUILD_PROGRESS === "1") {
    console.error(`[build] ${new Date().toISOString()} ${label}`);
  }
}

function compactAdmissionRuntimeRecord(record) {
  const compact = { ...record };
  delete compact.sourceAttachmentTitle;
  delete compact.sourceAttachmentUrl;
  delete compact.attachmentTitle;
  delete compact.attachmentUrl;
  delete compact.sourceFile;
  delete compact.sourcePath;
  delete compact.rawRow;
  delete compact.rawText;
  delete compact.rawColumns;
  return compact;
}

function normalizedAdmissionBatchForDedupe(batch) {
  const text = String(batch || "").replace(/\s+/g, "");
  if (text === "本科批") return "本科普通批";
  if (text === "专科批" || text === "高职专科批") return "高职（专科）批";
  return String(batch || "");
}

function admissionSchoolCodeForDedupe(record) {
  return String(record.schoolCode || record.majorCode || "").slice(0, 4);
}

function isOfficialAdmissionRecord(record) {
  return String(record.sourceQuality || "").includes("official") || String(record.sourceId || "").includes("official");
}

function readAdmissionData() {
  const files = fs.existsSync(ADMISSION_DIR)
    ? fs.readdirSync(ADMISSION_DIR).filter((name) => name.endsWith(".json") && name !== "schema.json").sort()
    : [];
  buildProgress(`reading ${files.length} admission JSON files`);
  const records = [];
  const rankRecords = [];
  const sourceNotes = [];
  const errors = [];
  files.forEach((name, index) => {
    if (process.env.BUILD_PROGRESS === "1" && (index === 0 || (index + 1) % 10 === 0 || index + 1 === files.length)) {
      buildProgress(`admission file ${index + 1}/${files.length}: ${name}`);
    }
    const file = path.join(ADMISSION_DIR, name);
    try {
      const payload = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const source of payload.sourceNotes ?? []) {
        sourceNotes.push({ ...source, file: path.relative(PROJECT_ROOT, file) });
      }
      for (const record of payload.records ?? []) {
        const recordWithSource = compactAdmissionRuntimeRecord(record);
        if (recordWithSource.dataType === "rank-conversion") {
          rankRecords.push(recordWithSource);
        } else {
          records.push(recordWithSource);
        }
      }
    } catch (error) {
      errors.push({ file: path.relative(PROJECT_ROOT, file), error: String(error) });
    }
  });
  buildProgress(`loaded ${records.length} admission records and ${rankRecords.length} rank records`);
  const recordsByKey = new Map();
  for (const record of records) {
    const key = [
      record.province,
      record.year,
      record.subjectType,
      normalizedAdmissionBatchForDedupe(record.batch),
      admissionSchoolCodeForDedupe(record),
      record.schoolName,
      record.majorName || "",
      record.majorGroup || "",
    ].join("|");
    const existing = recordsByKey.get(key);
    const recordIsOfficial = isOfficialAdmissionRecord(record);
    const existingIsOfficial = existing ? isOfficialAdmissionRecord(existing) : false;
    if (
      !existing ||
      (recordIsOfficial && !existingIsOfficial) ||
      (recordIsOfficial === existingIsOfficial && record.minRankEnd && !existing.minRankEnd) ||
      (recordIsOfficial && existingIsOfficial && !record.minRankEnd && !existing.minRankEnd)
    ) {
      recordsByKey.set(key, record);
    }
  }
  const uniqueRecords = [...recordsByKey.values()];
  buildProgress(`deduped admission records to ${uniqueRecords.length}`);
  const rankRecordsByKey = new Map();
  for (const record of rankRecords) {
    const key = [
      record.province,
      record.year,
      record.subjectType,
      record.rankUsage || "",
      record.rankCategory || "",
      record.rankLevelUsage || "",
      record.score,
    ].join("|");
    const existing = rankRecordsByKey.get(key);
    if (!existing || String(record.sourceQuality || "").includes("official")) {
      rankRecordsByKey.set(key, record);
    }
  }
  const uniqueRankRecords = [...rankRecordsByKey.values()].sort((a, b) =>
    String(a.province || "").localeCompare(String(b.province || ""), "zh-Hans-CN") ||
    (Number(b.year) || 0) - (Number(a.year) || 0) ||
    String(a.subjectType || "").localeCompare(String(b.subjectType || ""), "zh-Hans-CN") ||
    String(a.rankUsage || "").localeCompare(String(b.rankUsage || ""), "zh-Hans-CN") ||
    String(a.rankCategory || "").localeCompare(String(b.rankCategory || ""), "zh-Hans-CN") ||
    String(a.rankLevelUsage || "").localeCompare(String(b.rankLevelUsage || ""), "zh-Hans-CN") ||
    (Number(b.score) || 0) - (Number(a.score) || 0)
  );
  const scoreValues = uniqueRecords.map((item) => numericScore(item.minScore)).filter(Number.isFinite);
  const rankScores = uniqueRankRecords.map((item) => Number(item.score)).filter(Number.isFinite);
  const majorRecords = uniqueRecords.filter((item) => item.dataType === "major-admission");
  const majorTrendMap = new Map();
  for (const record of majorRecords) {
    const key = [
      record.province,
      record.subjectType,
      record.batch,
      record.schoolName,
      record.majorName || "",
      record.majorGroup || "",
    ].join("|");
    if (!majorTrendMap.has(key)) majorTrendMap.set(key, []);
    majorTrendMap.get(key).push(record);
  }
  const majorTrendPairs = [...majorTrendMap.values()]
    .map((items) => [...items].sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0)))
    .filter((items) => new Set(items.map((item) => item.year)).size >= 2);
  const majorTrendPairsWithRank = majorTrendPairs.filter((items) => items.filter((item) => item.minRankEnd).length >= 2);
  const majorTrendSeries3y = majorTrendPairs.filter((items) => new Set(items.map((item) => item.year).filter(Boolean)).size >= 3);
  const majorTrendSeries3yWithRank = majorTrendSeries3y.filter((items) =>
    new Set(items.filter((item) => item.minRankEnd).map((item) => item.year).filter(Boolean)).size >= 3
  );
  const majorTrendSeries4y = majorTrendPairs.filter((items) => new Set(items.map((item) => item.year).filter(Boolean)).size >= 4);
  const majorTrendSeries4yWithRank = majorTrendSeries4y.filter((items) =>
    new Set(items.filter((item) => item.minRankEnd).map((item) => item.year).filter(Boolean)).size >= 4
  );
  const hotMajorPattern = /计算机|软件|数据|人工智能|数字媒体|会计|护理|电气|自动化|电子商务|物联网|网络空间|信息安全|电子信息|通信工程/;
  const provinceBreakdown = [...new Set(uniqueRecords.map((item) => item.province).filter(Boolean))]
    .sort()
    .map((province) => {
      const provinceRecords = uniqueRecords.filter((item) => item.province === province);
      const provinceScores = provinceRecords.map((item) => numericScore(item.minScore)).filter(Number.isFinite);
      return {
        province,
        records: provinceRecords.length,
        years: [...new Set(provinceRecords.map((item) => item.year).filter(Boolean))].sort((a, b) => b - a),
        subjects: [...new Set(provinceRecords.map((item) => item.subjectType).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN")),
        dataTypes: countBy(provinceRecords, (item) => item.dataType || "unknown"),
        scoreRange: numericRange(provinceScores),
        lowBands: {
          below200: provinceRecords.filter((item) => hasScoreBelow(item, 200)).length,
          below250: provinceRecords.filter((item) => hasScoreBelow(item, 250)).length,
          below300: provinceRecords.filter((item) => hasScoreBelow(item, 300)).length,
          below500: provinceRecords.filter((item) => hasScoreBelow(item, 500)).length,
        },
      };
    });
  const rankCoverage = {
    records: uniqueRankRecords.length,
    provinces: [...new Set(uniqueRankRecords.map((item) => item.province).filter(Boolean))].sort(),
    years: [...new Set(uniqueRankRecords.map((item) => item.year).filter(Boolean))].sort((a, b) => b - a),
    subjects: [...new Set(uniqueRankRecords.map((item) => item.subjectType).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN")),
    scoreRange: numericRange(rankScores),
  };
  const rankSourceCoverage = buildRankSourceCoverage(sourceNotes, uniqueRankRecords);
  const provinceReadiness = buildProvinceReadiness({
    uniqueRecords,
    uniqueRankRecords,
    majorTrendPairs,
    majorTrendSeries3y,
    majorTrendSeries4y,
    rankSourceCoverage,
  });
  const formalScoreProvinces = new Set(uniqueRecords
    .filter((record) =>
      record.dataType !== "admission-plan" &&
      record.dataType !== "control-line" &&
      record.formalScoreScope !== "special-path-only" &&
      record.formalScoreScope !== "school-official-only" &&
      /official|chsi/.test(String(record.sourceQuality || "")) &&
      Number.isFinite(numericScore(record.minScore))
    )
    .map((record) => record.province)
    .filter(Boolean));
  const coverage = {
    files: files.length,
    rawRecords: records.length,
    records: uniqueRecords.length,
    rankConversionRecords: uniqueRankRecords.length,
    provinces: [...new Set(uniqueRecords.map((item) => item.province).filter(Boolean))].sort(),
    years: [...new Set(uniqueRecords.map((item) => item.year).filter(Boolean))].sort((a, b) => b - a),
    schools: [...new Set(uniqueRecords.map((item) => item.schoolName).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN")),
    cities: [...new Set(uniqueRecords.map((item) => item.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN")),
    schoolTags: [...new Set(uniqueRecords.flatMap((item) => item.schoolTags || []).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN")),
    scoreRange: numericRange(scoreValues),
    dataTypes: countBy(uniqueRecords, (item) => item.dataType || "unknown"),
    formalScoreProvinces: ALL_PROVINCES.filter((province) => formalScoreProvinces.has(province)),
    formalScoreMissingProvinces: ALL_PROVINCES.filter((province) => !formalScoreProvinces.has(province)),
    provinceBreakdown,
    provinceReadiness,
    yearBreakdown: [...new Set(uniqueRecords.map((item) => item.year).filter(Boolean))]
      .sort((a, b) => b - a)
      .map((year) => {
        const yearRecords = uniqueRecords.filter((item) => item.year === year);
        return {
          year,
          records: yearRecords.length,
          dataTypes: countBy(yearRecords, (item) => item.dataType || "unknown"),
          provinces: [...new Set(yearRecords.map((item) => item.province).filter(Boolean))].length,
          schools: [...new Set(yearRecords.map((item) => item.schoolName).filter(Boolean))].length,
        };
      }),
    majorTrendCoverage: {
      comparableMajorPairs: majorTrendPairs.length,
      comparableMajorPairsWithRank: majorTrendPairsWithRank.length,
      comparableHotMajorPairs: majorTrendPairs.filter((items) => hotMajorPattern.test(items[0]?.majorName || "")).length,
      comparableMajorSeries3y: majorTrendSeries3y.length,
      comparableMajorSeries3yWithRank: majorTrendSeries3yWithRank.length,
      comparableHotMajorSeries3y: majorTrendSeries3y.filter((items) => hotMajorPattern.test(items[0]?.majorName || "")).length,
      comparableMajorSeries4y: majorTrendSeries4y.length,
      comparableMajorSeries4yWithRank: majorTrendSeries4yWithRank.length,
      comparableHotMajorSeries4y: majorTrendSeries4y.filter((items) => hotMajorPattern.test(items[0]?.majorName || "")).length,
      longestMajorSeriesYears: Math.max(0, ...majorTrendPairs.map((items) => new Set(items.map((item) => item.year).filter(Boolean)).size)),
      provinces: [...new Set(majorTrendPairs.flatMap((items) => items.map((item) => item.province)).filter(Boolean))].sort(),
      samplePairs: majorTrendPairs.slice(0, 16).map((items) => ({
        province: items[0].province,
        subjectType: items[0].subjectType,
        schoolName: items[0].schoolName,
        majorName: items[0].majorName,
        years: items.map((item) => item.year),
      })),
      sampleSeries3y: majorTrendSeries3y.slice(0, 16).map((items) => ({
        province: items[0].province,
        subjectType: items[0].subjectType,
        schoolName: items[0].schoolName,
        majorName: items[0].majorName,
        years: items.map((item) => item.year),
      })),
      sampleSeries4y: majorTrendSeries4y.slice(0, 16).map((items) => ({
        province: items[0].province,
        subjectType: items[0].subjectType,
        schoolName: items[0].schoolName,
        majorName: items[0].majorName,
        years: items.map((item) => item.year),
      })),
    },
    lowBands: {
      below200: uniqueRecords.filter((item) => hasScoreBelow(item, 200)).length,
      below250: uniqueRecords.filter((item) => hasScoreBelow(item, 250)).length,
      below300: uniqueRecords.filter((item) => hasScoreBelow(item, 300)).length,
      below500: uniqueRecords.filter((item) => hasScoreBelow(item, 500)).length,
    },
  };
  return { records: uniqueRecords, rankRecords: uniqueRankRecords, sourceNotes, coverage, rankCoverage, rankSourceCoverage, errors };
}

function buildRecommendationBlueprint(docs) {
  const sourceHits = (keywords) => matchedDocsForLens(docs, { keywords }).slice(0, 8).map((item) => item.doc.id);
  return [
    {
      id: "profile",
      title: "1. 冷启动画像",
      body: "采集省份、批次、科类/选科、位次、预算、城市边界、专业倾向、不可接受项和特殊路径意愿。",
      sourceIds: sourceHits(["省份", "选科", "位次", "预算", "城市", "家长"]),
    },
    {
      id: "hard-filter",
      title: "2. 硬过滤",
      body: "先剔除选科不符、体检限报、批次不符、语种限制、资格不满足和协议不可接受的志愿单元。",
      sourceIds: sourceHits(["选科", "体检", "限报", "批次", "资格", "协议"]),
    },
    {
      id: "soft-score",
      title: "3. 软评分",
      body: "按专业适配、院校平台、城市资源、就业现实、家庭预算和风险承受度做可调权重评分。",
      sourceIds: sourceHits(["专业", "院校", "城市", "就业", "预算", "风险", "权重"]),
    },
    {
      id: "plan",
      title: "4. 方案生成",
      body: "生成冲、稳、保、兜底、备选和排除清单，并保留每个志愿单元的调剂接受度。",
      sourceIds: sourceHits(["冲", "稳", "保", "方案", "调剂", "排序"]),
    },
    {
      id: "explain",
      title: "5. 解释追溯",
      body: "解释推荐、保留和排除理由，回链到来源文件、音频转写、OCR 文本、整合轮次和官方复核动作。",
      sourceIds: sourceHits(["解释", "来源", "文件", "音频", "OCR", "ASR", "复核"]),
    },
    {
      id: "audit",
      title: "6. 官方复核与家庭确认",
      body: "对招生章程、招生计划、院校专业组、专业代码、学费、校区和不可接受项做最终确认。",
      sourceIds: sourceHits(["招生章程", "招生计划", "专业组", "专业代码", "学费", "校区"]),
    },
  ];
}

function buildAdmissionScoreLayer(docs) {
  const sourceHits = (keywords, limit = 10) => matchedDocsForLens(docs, { keywords }).slice(0, limit).map((item) => item.doc.id);
  const scoreEvidenceIds = sourceHits(["录取分数", "专业分数位次", "最低分", "最低位次", "投档线", "一分一段", "同位分", "院校名称", "风险评估"], 16);
  const admissionData = readAdmissionData();
  const hasRecords = admissionData.records.length > 0;
  const hasRankConversions = admissionData.rankRecords.length > 0;
  const planRecords = admissionData.records.filter((record) => record.dataType === "admission-plan");
  return {
    status: hasRecords ? "seed-structured-import" : "needs-structured-import",
    structuredRecords: admissionData.records.length,
    rankConversionRecords: admissionData.rankRecords.length,
    admissionPlanRecords: planRecords.length,
    admissionPlanCount: planRecords.reduce((sum, record) => sum + (Number(record.planCount) || 0), 0),
    statusLabel: hasRecords
      ? `已接入${admissionData.records.length}条结构化录取/计划数据${hasRankConversions ? ` + ${admissionData.rankRecords.length}条一分一段记录` : ""}`
      : "未接入结构化院校/专业录取分表",
    currentFinding: hasRecords
      ? `已建立可扩展的结构化录取数据层；${hasRankConversions ? "一分一段记录可先把分数换成同省同科类位次，" : ""}${planRecords.length ? "招生计划只作当年专业池和计划数约束，" : ""}当前录取分是种子数据，适合做具体院校/专业核验排序，正式填报仍要回到当年考试院、院校招生网和招生章程确认。`
      : "本地资料包含录取分/位次使用方法、风险评估模板和少量案例，但未形成可直接计算的全量结构化数据表。",
    records: admissionData.records,
    rankConversions: admissionData.rankRecords,
    sourceNotes: admissionData.sourceNotes,
    coverage: admissionData.coverage,
    provinceReadiness: admissionData.coverage.provinceReadiness,
    rankCoverage: admissionData.rankCoverage,
    rankSourceCoverage: admissionData.rankSourceCoverage,
    importErrors: admissionData.errors,
    availableEvidenceIds: scoreEvidenceIds,
    requiredTables: [
      {
        id: "institution-admission",
        title: "院校/院校专业组投档分表",
        purpose: "判断能否进档，以及冲稳保区间。",
        requiredColumns: ["province", "year", "subjectType", "batch", "schoolName", "schoolCode", "majorGroup", "planCount", "minScore", "minRank", "source"],
      },
      {
        id: "major-admission",
        title: "专业录取分表",
        purpose: "判断进档后能否进入目标专业，控制调剂风险。",
        requiredColumns: ["province", "year", "subjectType", "schoolName", "schoolCode", "majorName", "majorCode", "majorGroup", "planCount", "minScore", "minRank", "avgScore", "maxScore", "source"],
      },
      {
        id: "rank-conversion",
        title: "一分一段/同位分表",
        purpose: "把今年分数换成同省同科类位次，再与往年数据比较。",
        requiredColumns: ["province", "year", "subjectType", "score", "rankStart", "rankEnd", "sameRankScore", "source"],
      },
    ],
    gatingRules: [
      "没有结构化院校/专业录取分表时，模型不得输出录取概率、保录、稳上或必中结论。",
      "只有院校/专业组投档分时，可以做进档风险判断，但不能替代专业录取风险判断。",
      "只有专业录取分和最低位次时，才允许把目标专业可达性作为强排序依据。",
      "所有分数表必须限定省份、年份、科类/选科、批次和来源；跨省跨科类不得混用。",
    ],
    downgradeReason: hasRecords
      ? "已接入种子数据但覆盖仍有限；没有命中的省份/科类/院校/专业仍自动降级为候选核验。"
      : "缺少结构化录取分数据，当前推荐自动降级为'候选核验模型'。",
  };
}

function buildModelPolicy(docs) {
  const sourceHits = (keywords) => matchedDocsForLens(docs, { keywords }).slice(0, 10).map((item) => item.doc.id);
  return {
    name: "本地高考志愿可靠推荐模型",
    version: "local-deterministic-v3.44-gansu-2024-vocational-official-xls",
    modelType: "确定性规则评分模型",
    reliabilityDefinition: "录取分数据层优先；公开权重、来源证据、分省成熟度、置信度标签、排除理由和官方复核清单；没有结构化录取分或本省数据薄弱时自动降级，不输出录取概率。",
    formula: "有结构化录取分时：总分 = 40%录取分/位次安全边界 + 20%硬匹配 + 15%专业适配 + 10%城市预算 + 10%证据充分度 + 5%风险控制；无结构化录取分时降级为候选核验模型。",
    weights: [
      { key: "admissionScore", label: "录取分/位次", weight: 0.4, meaning: "院校/专业组投档分、专业录取分、最低位次和招生计划" },
      { key: "hardFit", label: "硬匹配", weight: 0.2, meaning: "省份、科类/选科、批次、体检/资格和路径边界" },
      { key: "majorFit", label: "专业适配", weight: 0.15, meaning: "门类、课程、能力、深造/就业出口与孩子画像匹配" },
      { key: "cityBudget", label: "城市预算", weight: 0.1, meaning: "城市资源、家庭预算、距离、学费和不可接受项" },
      { key: "evidence", label: "证据充分度", weight: 0.1, meaning: "本地来源命中数量、门类/主题覆盖和材料质量" },
      { key: "riskControl", label: "风险控制", weight: 0.05, meaning: "调剂、退档、计划变化、专业组和红线风险" },
    ],
    requiredInputs: ["省份", "科类/选科", "分数", "位次", "孩子类型", "专业方向", "城市偏好", "预算敏感度", "不可接受项", "院校/专业录取分表"],
    confidenceRules: [
      "A：输入完整，且命中同省同科类近年院校/专业录取分、最低位次和招生计划；仍必须官方核验。",
      "A-：输入完整且有院校/专业组投档分，但缺少目标专业录取分；只能强推院校，不能强推专业。",
      "B：本地证据充足但缺少结构化录取分，结果只作为候选核验清单。",
      "C：只适合作为探索方向；通常因为输入不足、证据弱或触发预算/红线风险。",
    ],
    scoreBands: [
      { id: "elite", label: "高位段", rule: "位次 <= 5000 或分数 >= 650", strategy: "平台上限、强学科和特殊高平台机会优先，但保留稳妥专业兜底。" },
      { id: "upper", label: "上位段", rule: "位次 <= 20000 或分数 >= 600", strategy: "双一流/强区域平台、优势城市和专业质量平衡。" },
      { id: "middle", label: "中位段", rule: "位次 <= 60000 或分数 >= 540", strategy: "专业适配、城市资源和稳妥录取边界优先。" },
      { id: "foundation", label: "基础段", rule: "其余情况", strategy: "本科兜底、高职双高、专升本和技能就业双路径同时看。" },
    ],
    officialChecks: [
      "当年本省考试院招生计划",
      "院校招生章程和专业录取规则",
      "院校专业组、院校代码、专业代码",
      "一分一段表与同科类位次",
      "专业选科要求、体检限报、语种限制",
      "学费、校区、培养地点、中外合作证书",
      "调剂范围、转专业规则和最低可接受专业",
    ],
    sourceIds: sourceHits(["模型", "推荐", "位次", "院校", "专业", "城市", "复核", "官方"]),
  };
}

function buildAudioQueue(docs) {
  const audioDocs = docs.filter((doc) => doc.kind === "audio");
  const duplicateMap = new Map();
  for (const doc of audioDocs) {
    const key = doc.audioNormalizedTitle || doc.title;
    const group = duplicateMap.get(key) ?? [];
    group.push(doc.id);
    duplicateMap.set(key, group);
  }
  const seriesMap = new Map();
  for (const doc of audioDocs) {
    const item = {
      id: doc.id,
      title: doc.title,
      relativePath: doc.relativePath,
      ext: doc.ext,
      bytes: doc.bytes,
      order: doc.audioOrder,
      priority: doc.asrPriority,
      reason: doc.asrReason,
      processingStatus: doc.processingStatus,
      textLength: doc.textLength,
      duplicateGroupSize: duplicateMap.get(doc.audioNormalizedTitle || doc.title)?.length ?? 1,
      domains: doc.domains.map((domain) => domain.label).slice(0, 3),
      disciplines: doc.disciplines.map((discipline) => `${discipline.code} ${discipline.name}`).slice(0, 3),
    };
    const current = seriesMap.get(doc.audioSeries) ?? {
      series: doc.audioSeries,
      files: 0,
      bytes: 0,
      priorities: {},
      items: [],
    };
    current.files += 1;
    current.bytes += doc.bytes;
    current.priorities[item.priority] = (current.priorities[item.priority] ?? 0) + 1;
    current.items.push(item);
    seriesMap.set(doc.audioSeries, current);
  }
  const series = [...seriesMap.values()].map((entry) => ({
    ...entry,
    items: entry.items.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, "zh-Hans-CN")),
  })).sort((a, b) => b.files - a.files || a.series.localeCompare(b.series, "zh-Hans-CN"));
  return {
    totalFiles: audioDocs.length,
    totalBytes: audioDocs.reduce((sum, doc) => sum + doc.bytes, 0),
    duplicateGroups: [...duplicateMap.values()].filter((group) => group.length > 1).length,
    priorityCounts: countBy(audioDocs, (doc) => doc.asrPriority),
    series,
  };
}

function buildExperienceInsights(docs) {
  const sourceHits = (keywords) => matchedDocsForLens(docs, { keywords }).slice(0, 8).map((item) => item.doc.id);
  return [
    {
      id: "new-gaokao-current-state",
      title: "新高考现状：专业组和选科约束前置",
      body: "本地材料把新高考逻辑单独列出，说明志愿判断已经从单纯院校优先，转向院校专业组、选科要求、组内调剂和专业排序的组合判断。",
      sourceIds: sourceHits(["新高考", "院校专业组", "选科", "志愿填报逻辑"]),
    },
    {
      id: "parallel-volunteer-risk",
      title: "平行志愿降低滑档概率，但不消除退档风险",
      body: "平行志愿解决的是投档顺序问题，不代表进档后一定能被满意专业录取；招生章程、专业录取规则、服从调剂和体检限报仍然要逐项核对。",
      sourceIds: sourceHits(["平行志愿", "退档", "调剂", "招生章程", "专业录取规则"]),
    },
    {
      id: "hot-major-reality",
      title: "热门专业要回到产业链、能力和学校平台",
      body: "资料里反复出现行业、体制内外、电力、基建、材料、计算机、金融等主题，适合把专业热度拆成行业周期、能力门槛、城市机会和院校平台。",
      sourceIds: sourceHits(["行业", "体制内", "电力", "基建", "材料", "计算机", "金融"]),
    },
    {
      id: "school-name-risk",
      title: "院校改名、合并、分校和中外合作要单独核验",
      body: "院校层次不能只看校名。改名合并、校区分布、分校、中外合作学费和培养地点都会改变真实就读体验和风险。",
      sourceIds: sourceHits(["改名", "合并", "分校", "中外合作"]),
    },
    {
      id: "special-path-cost",
      title: "特殊路径的机会和代价必须一起呈现",
      body: "军校、警校、公费师范、定向士官、专项计划、综合评价、港澳院校等路径不能只写优势，还要写资格、流程、体检政审、协议服务期和退出成本。",
      sourceIds: sourceHits(["军校", "警校", "公费师范", "定向士官", "专项计划", "综合评价", "港澳"]),
    },
    {
      id: "data-boundary",
      title: "数据工具只能辅助，不能替代当年政策核对",
      body: "专业目录、院校名单、学科评估和往年录取数据是底座，但正式填报仍要以当年省考试院、招生计划和院校招生章程为准。",
      sourceIds: sourceHits(["专业目录", "院校名单", "学科评估", "往年", "招生计划"]),
    },
  ];
}

function buildKnowledge(docs, rounds, options = {}) {
  const extractionStats = {
    totalFiles: docs.length,
    textExtractedFiles: docs.filter((doc) => doc.textLength > 0).length,
    ocrExtractedFiles: docs.filter((doc) => doc.processingStatus === "ocr-extracted").length,
    ocrExtractedPages: docs.reduce((sum, doc) => sum + (doc.ocrPages || 0), 0),
    asrTranscribedFiles: docs.filter((doc) => doc.processingStatus === "asr-transcribed").length,
    asrPartialFiles: docs.filter((doc) => doc.processingStatus === "asr-partial-transcribed").length,
    audioIndexedFiles: docs.filter((doc) => doc.kind === "audio").length,
    imageIndexedFiles: docs.filter((doc) => doc.kind === "image").length,
    needsChineseOcrFiles: docs.filter((doc) => doc.needsChineseOcr || doc.processingStatus === "image-indexed-needs-chinese-ocr" || doc.processingStatus === "pdf-indexed-needs-chinese-ocr").length,
    needsAudioTranscriptFiles: docs.filter((doc) => doc.kind === "audio" && doc.processingStatus !== "asr-transcribed").length,
  };
  const modelPolicy = buildModelPolicy(docs);
  if (options.modelPolicyPatch) Object.assign(modelPolicy, options.modelPolicyPatch);
  return {
    generatedAt: options.generatedAt || new Date().toISOString(),
    project: {
      name: "高考志愿本地知识库",
      mode: "local-static-site",
      sourceRoots: SOURCE_ROOTS,
      processingBoundary: "未把大音频和外盘资料整体复制进项目；每个文件单独临时 staging 到内部 APFS 后抽取，音频通过 whisper.cpp ASR 与 ffmpeg WMA 临时转码完成全文转写。",
      ocrBoundary: OCR_ENABLED ? `中文 OCR 已启用：${OCR_LANG} / ${OCR_TESSDATA_DIR}` : "中文 OCR 未启用，可安装 chi_sim.traineddata 或设置 TESSDATA_DIR 后重建。",
    },
    extractionStats,
    fileTypeCounts: countBy(docs, (doc) => doc.ext),
    kindCounts: countBy(docs, (doc) => doc.kind),
    domainCounts: countBy(docs.flatMap((doc) => doc.domains.map((d) => d.label)), (x) => x),
    disciplineCounts: countBy(docs.flatMap((doc) => doc.disciplines.map((d) => `${d.code} ${d.name}`)), (x) => x),
    domains: DOMAINS,
    disciplines: DISCIPLINES,
    strategyFramework: buildStrategyFramework(docs),
    modelPolicy,
    admissionScoreLayer: options.admissionScoreLayer || buildAdmissionScoreLayer(docs),
    recommendationBlueprint: buildRecommendationBlueprint(docs),
    experienceInsights: buildExperienceInsights(docs),
    riskChecklist: buildRiskChecklist(),
    audioQueue: buildAudioQueue(docs),
    rounds: rounds.map((round) => ({
      id: round.id,
      title: round.title,
      purpose: round.purpose,
      coverage: round.coverage,
      topSources: round.topSources,
      integratedNotes: round.integratedNotes,
    })),
    sourceFiles: docs.map((doc) => ({
      id: doc.id,
      title: doc.title,
      relativePath: doc.relativePath,
      absolutePath: doc.absolutePath,
      ext: doc.ext,
      kind: doc.kind,
      bytes: doc.bytes,
      textLength: doc.textLength,
      excerpt: doc.excerpt,
      processingStatus: doc.processingStatus,
      processingGap: doc.processingGap,
      pages: doc.pages,
      ocrLanguage: doc.ocrLanguage,
      ocrPages: doc.ocrPages,
      audioSeries: doc.audioSeries || "",
      audioOrder: doc.audioOrder || 0,
      asrPriority: doc.asrPriority || "",
      asrReason: doc.asrReason || "",
      asrModel: doc.asrModel || "",
      asrDurationMs: doc.asrDurationMs || 0,
      asrGeneratedAt: doc.asrGeneratedAt || "",
      domains: doc.domains,
      disciplines: doc.disciplines,
    })),
    gaps: [
      OCR_ENABLED ? "中文 OCR 已启用；低清晰度扫描件仍可能需要人工复核。" : "本机 tesseract 缺少中文语言包，纯图片 PDF/JPG 目前只能标题和路径级归纳。",
      "本地 whisper.cpp ASR 链路已打通；MP3 与 WMA 均已逐个离线转写，WMA 通过 ffmpeg 临时转成 ASR 输入。",
      "部分旧版 .doc/.ppt/.xls 只能通过 textutil 或 strings 抽取，可读性低于 docx/pptx/xlsx/pdf 文本层。",
      "政策会按省份和年份变化，正式志愿填报前必须回到当年省考试院、院校招生章程和最新专业目录核对。",
    ],
  };
}

function writeReports(knowledge) {
  const lines = [];
  lines.push("# 高考志愿资料整合报告");
  lines.push("");
  lines.push(`生成时间：${knowledge.generatedAt}`);
  lines.push("");
  lines.push("## 覆盖范围");
  lines.push("");
  lines.push(`- 文件总数：${knowledge.extractionStats.totalFiles}`);
  lines.push(`- 已抽取文本：${knowledge.extractionStats.textExtractedFiles}`);
  lines.push(`- OCR 抽取文件：${knowledge.extractionStats.ocrExtractedFiles}`);
  lines.push(`- OCR 抽取页数：${knowledge.extractionStats.ocrExtractedPages}`);
  lines.push(`- ASR 完整转写文件：${knowledge.extractionStats.asrTranscribedFiles}`);
  lines.push(`- ASR 部分转写文件：${knowledge.extractionStats.asrPartialFiles}`);
  lines.push(`- 音频待完整转写：${knowledge.extractionStats.needsAudioTranscriptFiles}`);
  lines.push(`- 中文 OCR 待处理：${knowledge.extractionStats.needsChineseOcrFiles}`);
  lines.push("");
  lines.push("## 音频 ASR 库");
  lines.push("");
  lines.push(`- 音频文件：${knowledge.audioQueue.totalFiles}`);
  lines.push(`- 音频体量：${(knowledge.audioQueue.totalBytes / 1024 / 1024 / 1024).toFixed(2)} GiB`);
  lines.push(`- 重复标题组：${knowledge.audioQueue.duplicateGroups}`);
  for (const [priority, count] of Object.entries(knowledge.audioQueue.priorityCounts)) {
    lines.push(`- ${priority}：${count}`);
  }
  for (const series of knowledge.audioQueue.series.slice(0, 8)) {
    lines.push(`- ${series.series}：${series.files} 个音频`);
  }
  lines.push("");
  lines.push(`## ${knowledge.rounds.length}轮整合`);
  lines.push("");
  for (const round of knowledge.rounds) {
    lines.push(`### Round ${round.id} ${round.title}`);
    lines.push("");
    lines.push(`- 覆盖文件：${round.coverage.totalFilesSeen}`);
    lines.push(`- 本轮命中：${round.coverage.matchedFilesForLens}`);
    for (const note of round.integratedNotes) lines.push(`- ${note}`);
    lines.push("");
  }
  lines.push("## 诚实边界");
  lines.push("");
  for (const gap of knowledge.gaps) lines.push(`- ${gap}`);
  fs.writeFileSync(path.join(REPORT_DIR, "extraction-report.md"), lines.join("\n"), "utf8");
}

function writeJsonStreamingSync(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, "w");
  const write = (chunk) => fs.writeSync(fd, chunk);
  const emit = (item) => {
    if (Array.isArray(item)) {
      write("[");
      item.forEach((entry, index) => {
        if (index) write(",");
        emit(entry);
      });
      write("]");
      return;
    }
    if (item && typeof item === "object") {
      write("{");
      Object.entries(item).forEach(([key, entry], index) => {
        if (index) write(",");
        write(JSON.stringify(key));
        write(":");
        emit(entry);
      });
      write("}");
      return;
    }
    write(JSON.stringify(item));
  };
  try {
    emit(value);
    write("\n");
  } finally {
    fs.closeSync(fd);
  }
}

function runJqToFile(args, outFile) {
  const outFd = fs.openSync(outFile, "w");
  const result = spawnSync("jq", args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    stdio: ["ignore", outFd, "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  fs.closeSync(outFd);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([
      `jq ${args.join(" ")} failed with status ${result.status}`,
      result.stderr?.trim(),
    ].filter(Boolean).join("\n"));
  }
}

function refreshAdmissionsOnly() {
  ensureDirs();
  const manifestPath = path.join(DATA_DIR, "manifest.json");
  const knowledgePath = path.join(DATA_DIR, "knowledge.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error("ADMISSIONS_ONLY=1 requires existing data/manifest.json. Run the full build once first.");
  }
  buildProgress("reading manifest");
  const docs = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  buildProgress("building admission score layer");
  const admissionScoreLayer = buildAdmissionScoreLayer(docs);
  const generatedAt = new Date().toISOString();
  const version = `local-deterministic-v3.228-henan-2024-undergraduate2-third-party-content-mirror-${admissionScoreLayer.structuredRecords}records`;
  const reliabilityDefinition = "全国通用录取分数据层优先；按省份、年份、科类/选科、批次、专业组和专业分隔离计算；分省成熟度进入风险提示；未导入目标省份数据或本省数据薄弱时自动降级，不输出录取概率。";
  const tempKnowledgePath = path.join(TMP_ROOT, "knowledge.refreshed.json");
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  buildProgress("rebuilding rounds from manifest");
  fs.rmSync(ROUND_DIR, { recursive: true, force: true });
  fs.mkdirSync(ROUND_DIR, { recursive: true });
  const rounds = buildRounds(docs);
  buildProgress("assembling refreshed knowledge");
  const knowledge = buildKnowledge(docs, rounds, {
    generatedAt,
    admissionScoreLayer,
    modelPolicyPatch: { version, reliabilityDefinition },
  });
  buildProgress("stream-writing refreshed knowledge");
  writeJsonStreamingSync(tempKnowledgePath, knowledge);
  buildProgress("writing data/knowledge.json");
  fs.renameSync(tempKnowledgePath, knowledgePath);
  buildProgress("writing site/data/knowledge.json");
  fs.copyFileSync(knowledgePath, path.join(SITE_DATA_DIR, "knowledge.json"));
  writeReports(knowledge);
  console.log(JSON.stringify({
    ok: true,
    mode: "admissions-only",
    modelVersion: version,
    structuredRecords: admissionScoreLayer.structuredRecords,
    provinces: admissionScoreLayer.coverage?.provinces || [],
    years: admissionScoreLayer.coverage?.years || [],
  }, null, 2));
}

function main() {
  if (process.env.ADMISSIONS_ONLY === "1") {
    refreshAdmissionsOnly();
    return;
  }
  ensureDirs();
  for (const root of SOURCE_ROOTS) {
    if (!fs.existsSync(root)) {
      throw new Error(`Missing source root: ${root}`);
    }
  }
  if (!REUSE_EXTRACTS) fs.rmSync(EXTRACT_DIR, { recursive: true, force: true });
  fs.rmSync(ROUND_DIR, { recursive: true, force: true });
  fs.mkdirSync(EXTRACT_DIR, { recursive: true });
  fs.mkdirSync(ROUND_DIR, { recursive: true });

  const docs = buildManifest();
  const rounds = buildRounds(docs);
  const knowledge = buildKnowledge(docs, rounds);

  fs.writeFileSync(path.join(DATA_DIR, "manifest.json"), JSON.stringify(docs, null, 2), "utf8");
  const knowledgeJson = JSON.stringify(knowledge);
  fs.writeFileSync(path.join(DATA_DIR, "knowledge.json"), knowledgeJson, "utf8");
  fs.writeFileSync(path.join(SITE_DATA_DIR, "knowledge.json"), knowledgeJson, "utf8");
  writeReports(knowledge);

  console.log(JSON.stringify({
    ok: true,
    totalFiles: knowledge.extractionStats.totalFiles,
    textExtractedFiles: knowledge.extractionStats.textExtractedFiles,
    audioIndexedFiles: knowledge.extractionStats.audioIndexedFiles,
    needsChineseOcrFiles: knowledge.extractionStats.needsChineseOcrFiles,
    rounds: knowledge.rounds.length,
  }, null, 2));
}

main();

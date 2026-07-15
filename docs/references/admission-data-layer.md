# 全国录取数据层

本地推荐器从 `data/admissions/*.json` 读取结构化录取数据。每条记录必须保留省份、年份、科类、批次、院校、专业或专业组、最低分/最低位次、来源和来源质量。

推荐边界同步升级：普通智能推荐排除 `special-path-only`，学校官网 `school-official-only` 证据最高只到 A-，并强制提示“单校边界、非省级全量表”；只有省级正式投档/录取证据才允许进入 A 级判断。

覆盖元数据同步清理：历史 22 条 `province=内蒙` 记录已统一为 `内蒙古`，对应 `provinceBreakdown` 合并后为 15200 条，顶层省级覆盖数组由错误的 32 个别名标签恢复为 31 个规范省级口径；记录总数不变。

v3.271 当前运行版本为 `local-deterministic-v3.271-beijing-rank2025-841776records`：全国主库 841776 条、31 个浏览器省份分片、116656 条位次换算和 5082 条来源说明。新增北京教育考试院《[北京市2025年高考考生分数分布](https://www.bjeea.cn/html/gkgz/tzgg/2025/0625/87165.html)》官方页面及 10 页 PDF 证据，解析 347 条综合类位次换算；318 条逐分行和 29 条官方合并分数段原样保存，累计人数不变量逐行通过，650 分累计位次为 3203，最终累计人数为 65434。既有第三方北京 2025 图片队列标记为被 `official-beijing-rank-2025-v3271` 替代，不再重复排队，也不把一分一段人数解释为院校录取概率。

v3.271 浏览器运行边界：31 个分片合计 841776 条录取/计划/资格记录、116656 条位次换算，unknown records 和 unknown rank conversions 均为 0；北京分片为 6442 条录取/计划记录和 688 条位次换算，其中新增北京 2025 官方记录 347 条，且全部保留 `dataType` 与官方 `sourceQuality`。合并分段显示“同区间”而非“同分”；本科/专科路径双向隔离，北京 650 分画像专科记录为 0，职业技术大学本科批不会因校名被误伤；学费未知中外合作记录在复合家庭红线下按风险冲突排除。v3.270 的西藏计划更正继续存在，西藏分片仍为 26111 条；西藏可计算一分一段、普通省级全量投档/录取表、专业最低位次和高职专科投档数据缺口继续保留。

v3.270 上一运行版本为 `local-deterministic-v3.270-xizang-ctgu-plan-correction2026-841776records`：全国主库 841776 条、31 个浏览器省份分片、116309 条位次换算和 5081 条来源说明。新增西藏自治区教育考试院 2026-06-27《[关于更正三峡大学招生计划的公告](http://zsks.edu.xizang.gov.cn/71/74/7894.html)》证据，对 ID `2026-xizang-plan-0a1d8e04b447e164ed` 执行唯一键原位更正：院校代码/名称从 `0329 三峡大学` 改为 `1466 三峡大学(中外合作办学)`，专业代码 04、专业名称、学制、计划 2 名、学费 50000 元和备注均保持不变。主库保存原院校/原来源与更正来源，分片保留更正说明和“不得调换专业、教学外语为英语”限制。计划级红线会排除高学费中外合作冲突记录，但不排除三峡大学普通计划；该记录仍不提供录取概率。

v3.270 浏览器运行边界（上一版本）：31 个分片合计仍为 841776 条录取/计划/资格记录、116309 条位次换算，unknown records 和 unknown rank conversions 均为 0；西藏分片仍为 26111 条。更正是 1 对 1 替换而非追加，目标 ID 恰好一条、旧代码 0329 残留为 0；西藏可计算一分一段、普通省级全量投档/录取表、专业最低位次和高职专科投档数据缺口继续保留。

v3.269 上一运行版本为 `local-deterministic-v3.269-xizang-military-control2026-841776records`：全国主库 841776 条、31 个浏览器省份分片、116309 条位次换算和 5080 条来源说明。新增西藏自治区教育考试院 2026 军队院校面试体检控制分数线 6 条，官方 HTML、图片和 Vision OCR 均本地留证并记录 SHA-256；六条按科类、性别、A/B 类隔离，全部为 `special-path-only` 资格线，源表无位次时保留 `rankUnavailable=true` 和 `scoreOnly=true`。分片构建器同步保留这些可靠性字段，普通智能推荐仍通过 `isSpecialPathRecord` 和 profile 过滤排除本层。该增量不提升西藏普通批成熟度，不关闭一分一段、普通投档/录取表、专业最低位次或高职专科数据缺口。

v3.269 浏览器运行边界（上一版本）：31 个分片合计 841776 条录取/计划/资格记录、116309 条位次换算，unknown records 和 unknown rank conversions 均为 0；西藏分片 26111 条、0 条位次换算，其中新增军队院校资格线 6 条。`rankUnavailable`、`scoreOnly`、候选性别、A/B 类和资格线类型已加入浏览器分片保留字段，避免主库到网页运行层丢失可靠性边界。

v3.268 当前运行版本为 `local-deterministic-v3.268-national-school-official-bnu2025-841770records`：31 个省级口径合计 841770 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5079 条来源说明，年份覆盖 2010-2026。v3.268 新增 `data/admissions/official-national-school-admission-2025-v3268-bnu-import.json`，从北京师范大学本科生招生网 2026-03-25 发布的 2025 年全国 31 省 PDF 导入 30 省 178 条单校边界：155 条院校调档线，其中 149 条保留学校官方最低位次；23 条同行字段完整的分专业计划/最高分/最低分。普通类 92 条按 `school-official-only` 保存，公费师范、优师、国家/高校专项和艺体等 86 条按 `special-path-only` 隔离；1101 个跨行、合并单元格或字段不完整候选只进入 skipped audit，不猜专业、科类或路径。西藏 PDF 已由既有 `official-bnu-xizang-2025-school-admission` 同源导入覆盖，本轮不重复计数。新源坏分数 0、错误 rank flag 0、重复 ID 0、普通路径异常低/高分 0；特殊路径 73.5 分艺术成绩未计入普通低分段统计。合并同时把 `modelPolicy.version` 从历史滞留值修正为当前 v3.268。v3.267 曾先接入中国科学院大学官方 2019-2025 历年分数线 217 条，使运行层到 841592 条。学校官网单校分数不替代省级考试院全量投档/录取表，严格省级正式分数表缺口仍为西藏。

v3.268 浏览器运行边界：全国完整主库继续保留 841770 条记录，但网页首屏只读取 `knowledge-core.json`，生成推荐时再按省份读取 `site/data/provinces/*.json`。31 个分片合计 841770 条录取记录、116309 条位次换算记录，构建审计中 unknown records 为 0。普通推荐过滤 `special-path-only`，学校官网单校边界保留 A- 上限；候选池增加院校层次、城市和专业门类硬门槛，防止仅凭“同属工学”等宽泛条件产生错误院校分类。

v3.266 当前运行数据：`site/data/knowledge.json` 已升至 `local-deterministic-v3.266-national-school-official-dzu2020-2025-841375records`，含 841375 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5077 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.266 新增 `data/admissions/official-national-school-admission-2020-2025-v3266-dzu-import.json`，从德州学院本科招生信息网历年分数页 `https://zs.dzu.edu.cn/index/lnfs.htm` 嵌入的官方前端数据表抽取 1086 条 2020-2025 年 23 个省级口径单校分专业记录，并保留 3 个 raw 证据文件（官网 HTML、embedded-data JSON、正文抽取文本）。该源全部为 `major-admission`；311 条公开录取最低位次，775 条保持 `rankUnavailable=true`；普通学校官网专业边界 656 条按 `school-official-only` 保存，公费师范、校企合作、中外合作、定向、艺术、体育和春季高考等 430 条按 `special-path-only` 隔离；最低分范围 73.41-651.9914，最低位次范围 49-420771，普通学校官网边界异常分为 0；源表中 8 条无可用最低分的行只进入审计，不入预测记录。运行镜像、本地 `data/knowledge.json` 与 `site/data/knowledge.json` SHA256 均为 `d2209b4717515f2845202a5d96b8dc28f040af436c9da9104214f3935c1f24bc`；导入包 SHA256 为 `75fa38f2ee8b45915366fb8cbddb6fa35a8b9f2f641326c83d63ac81655693f8`。HTTP 4177/4203 完整流式读回均为 `x-gaokao-data-source: mac_2T-mirror`、响应体 1819803111 bytes、SHA256 同为 `d2209b4717515f2845202a5d96b8dc28f040af436c9da9104214f3935c1f24bc`。学校官网单校分数不替代任何省级考试院全量投档/录取表；正式省级缺口仍为西藏。

v3.265 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.265-national-school-official-ustb2020-2022-840289records`，含 840289 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5076 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.265 新增 `data/admissions/official-national-school-admission-2020-2022-v3265-ustb-import.json`，从北京科技大学本科招生网历年分数页 `https://zhaosheng.ustb.edu.cn/zkxx/lnfs/index.htm`、官方筛选 JSON `https://zhaosheng.ustb.edu.cn/data/puslishedbkzsjson/lnfsfilter.json` 和官方静态分数 JSON `https://zhaosheng.ustb.edu.cn/data/puslishedbkzsjson/lnfs.json` 抽取 2039 条 2020-2022 年全国 31 个省级口径单校分专业最高分、最低分和录取人数记录，并保留 4 个 raw 证据文件（页面、filter JSON、主 JSON、正文抽取文本）。该源全部为 `major-admission` 和 `scoreOnly=true`；源页未公开最低位次，2039 条均保持 `rankUnavailable=true`；普通学校官网专业边界 1590 条按 `school-official-only` 保存，国家专项和艺术类 449 条按 `special-path-only` 隔离；最低分范围 372-707，最高分范围 372-708，录取人数合计 9766，普通学校官网边界异常高分为 0。运行镜像、本地 `data/knowledge.json` 与 `site/data/knowledge.json` SHA256 均为 `397b2c4c56ea77e1b5bd9be2ef88ea036259bde88e4cd0a2dc09dc912daca453`；导入包 SHA256 为 `6ed7ffd86d377368e2e3f8f5c540579a7027b91d0b6b7dc014d68fca6b4ff31f`。HTTP 4177/4203 完整流式读回均为 `x-gaokao-data-source: mac_2T-mirror`、响应体 1816422756 bytes、SHA256 同为 `397b2c4c56ea77e1b5bd9be2ef88ea036259bde88e4cd0a2dc09dc912daca453`。学校官网单校分数不替代任何省级考试院全量投档/录取表；正式省级缺口仍为西藏。

v3.264 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.264-national-school-official-hubu2021-2025-838250records`，含 838250 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5075 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.264 新增 `data/admissions/official-national-school-admission-2021-2025-v3264-hubu-import.json`，从湖北大学本科招生信息网历年分数页 `https://zsxx.hubu.edu.cn/zsxx/lnfs.htm`、分专业录取分数页 `https://zsxx.hubu.edu.cn/fzylqfs.htm` 和官方静态 JSON `https://zsxx.hubu.edu.cn/json_2025121915717.json` 抽取 2851 条 2021-2025 年 27 个省级口径单校分专业最低投档成绩记录，并保留 4 个 raw 证据文件（索引页、分专业页、JSON、正文抽取文本）。该源全部为 `major-admission` 和 `scoreOnly=true`；源页未公开最低位次，2851 条均保持 `rankUnavailable=true`；普通学校官网专业边界 2679 条按 `school-official-only` 保存，国家专项、地方专项、艺术类等 172 条按 `special-path-only` 隔离；分数范围 391-642，普通学校官网边界异常高分为 0；该源覆盖 27 个省级口径，缺失省份不补假记录。运行镜像、本地 `data/knowledge.json` 与 `site/data/knowledge.json` SHA256 均为 `48e388f75042524fda9e051a25239ba54c11212436107b4db1413f85f6bec4ec`；导入包 SHA256 为 `c312da243dc843aa46ca90b91fe4ab1bc30bf331da20a8fba984b9f43a99281d`。HTTP 4177/4203 完整流式读回均为 `x-gaokao-data-source: mac_2T-mirror`、响应体 1809658324 bytes、SHA256 同为 `48e388f75042524fda9e051a25239ba54c11212436107b4db1413f85f6bec4ec`。学校官网单校分数不替代任何省级考试院全量投档/录取表；正式省级缺口仍为西藏。

v3.263 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.263-national-school-official-pku2015-2025-835399records`，含 835399 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5074 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.263 新增 `data/admissions/official-national-school-admission-2015-2025-v3263-pku-import.json`，从北京大学本科招生网录取分数线索引页 `https://bkzs.pku.edu.cn/xxgk/lqfsx/index.htm` 和官方详情页 `https://bkzs.pku.edu.cn/xxgk/lqfsx/2f23dc2f47ae4f46a90d39efd06c7b1a.htm` 抽取 727 条 2015-2025 年全国 31 省单校分省分类别最低分记录，并保留 3 个 raw 证据文件（索引页、详情 HTML、正文抽取文本）。该源全部为 `institution-admission` 和 `scoreOnly=true`；源页未公开最低位次，727 条均保持 `rankUnavailable=true`；普通学校官网边界 682 条按 `school-official-only` 保存，提前批/特殊语种/民族/藏汉等 45 条按 `special-path-only` 隔离；分数范围 400-885，海南等特殊总分/转换分口径按官网原文保留，普通 750 分省份学校官网边界异常高分为 0；2 行港澳台侨联招不混入内地 31 省模型。运行镜像、本地 `data/knowledge.json` 与 `site/data/knowledge.json` SHA256 均为 `dc08f8658a0080f031c35a3a1affc17cdb69df95a031e17a62e3b7998e8cb314`；导入包 SHA256 为 `c3585f0f3d8bc0d50e7bf4b2039c9f89089cd95bd43fdc0f3b1836004644a511`。学校官网单校分数不替代任何省级考试院全量投档/录取表。

v3.262 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.262-national-school-official-tsinghua2020-2024-834672records`，含 834672 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5073 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.262 新增 `data/admissions/official-national-school-admission-2020-2024-v3262-tsinghua-import.json`，从清华大学本科招生网“历年录取分数线”列表页及 2020-2024 年 5 个官方分年页面抽取 712 条全国 31 省单校分省分批次最低分记录，并保留 11 个 raw 证据文件（索引页、5 个 HTML、5 个正文抽取文本）。该源全部为 `institution-admission` 和 `scoreOnly=true`；源页未公开最低位次，712 条均保持 `rankUnavailable=true`；普通/医学学校官网边界 367 条按 `school-official-only` 保存，提前批/定向、国家专项、马克思主义理论、艺术史论等 345 条按 `special-path-only` 隔离；分数范围 423-900，其中 900 为海南特殊总分/转换分口径，普通学校官网边界异常高分为 0。运行镜像、本地 `data/knowledge.json` 与 `site/data/knowledge.json` SHA256 均为 `31e82bbcbd11fb2a8c6ea30988765a52709acd04acbeffec45064410c44f8ba5`；导入包 SHA256 为 `3b9f0bbd27a2ea5d41ec0fb76bdcd9cdc87e33a30f45dde584abd62618ad050b`。学校官网单校分数不替代任何省级考试院全量投档/录取表。

v3.261 历史说明：`site/data/knowledge.json` 已升至 `local-deterministic-v3.261-national-school-official-swjtu2022-2025-833960records`，含 833960 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5072 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.261 新增 `data/admissions/official-national-school-admission-2022-2025-v3261-swjtu-import.json`，从西南交通大学本科招生官网、官方“本科招生计划和录取查询”静态页抽取 7793 条 2022-2025 年全国 31 省单校分专业录取数、省控线、最高分、最低分、平均分和最低分位次记录，并保留 127 个 raw 证据文件。该源全部为 `major-admission`；6929 条公开最低分位次，864 条保持 `rankUnavailable=true`；普通学校官网边界 4863 条按 `school-official-only` 保存，国家/高校专项、中外合作、艺术、体育、预科、内地班等 2930 条按 `special-path-only` 隔离；分数范围 63.4-812.6，低于 150 或高于 750 的 57 条均为特殊路径艺术/音乐等综合分或专业分，普通学校官网边界异常分为 0；新增西藏 146 条单校记录，但不替代省级全量正式表。运行镜像、本地 `data/knowledge.json` 与 `site/data/knowledge.json` SHA256 均为 `9e2a6a4d50a9479659d5a21d4cfcb8076f731c4e5aa2ade9a90f28566f823a3e`；导入包 SHA256 为 `ca4a4f95df553145cf2daed6d727c348729f57cadf1f046665f3bf04646f8017`。学校官网单校分数不替代任何省级考试院全量投档/录取表；正式省级缺口仍为西藏。

v3.260 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.260-national-school-official-cdu2022-2025-826167records`，含 826167 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5071 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.260 新增 `data/admissions/official-national-school-admission-2022-2025-v3260-cdu-import.json`，从成都大学招生办公室官网、官方历年分数查询 SPA 和 `zhaosheng.cdu.edu.cn/zsdata/api/lqxx/s` API 抽取 3858 条 2022-2025 年全国 30 省单校分专业/概况录取最高分、平均分、最低分和最低位次记录，并保留 442 个 raw 证据文件。该源含 `major-admission` 3388 条、`institution-admission` 470 条；3304 条公开最低分位次，554 条保持 `rankUnavailable=true`；普通学校官网边界 3113 条按 `school-official-only` 保存，艺术体育、国家/地方专项、中外合作、普通中高计划、职教本科、对口/单独考试、公费师范、一类模式预科、单列类等 745 条按 `special-path-only` 隔离；分数范围 58-745，低于 150 或高于 750 的 60 条均为艺术体育特殊计分，普通学校官网边界异常分为 0。源系统未列西藏，不生成西藏假记录；运行镜像、本地 `data/knowledge.json` 与 `site/data/knowledge.json` SHA256 均为 `0060f1abd1fcb62c9153a499eaec452d590d465d3548d998c51d7fa3efc543a1`；导入包 SHA256 为 `febd508803c0c90dd4ff15dfe44117afe4b3e13c6a2af5cc8785be8d5c35fa4c`。学校官网单校分数不替代任何省级考试院全量投档/录取表；正式省级缺口仍为西藏。

v3.259 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.259-national-school-official-sicau2023-2025-822309records`，含 822309 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5070 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.259 新增 `data/admissions/official-national-school-admission-2023-2025-v3259-sicau-import.json`，从四川农业大学本科招生网官方历年分数查询 SPA 和 `zsdata.sicau.edu.cn/lqxx/s` API 抽取 3633 条 2023-2025 年全国 31 省单校分专业/概况录取最高分、平均分、最低分和最低位次记录，并保留 235 个 raw 证据文件。该源含 `major-admission` 3407 条、`institution-admission` 226 条；3105 条公开最低分位次，528 条保持 `rankUnavailable=true`；普通学校官网边界 2837 条按 `school-official-only` 保存，艺术体育、专项、预科、新疆班/西藏班、乡村振兴、帮扶计划、中外高水平交流计划等 796 条按 `special-path-only` 隔离；分数范围 73-759，低于 150 或高于 750 的 31 条均为艺术体育特殊计分，普通学校官网边界异常分为 0。2025 年西藏已有同校窄源，本轮显式跳过避免重复。运行镜像、本地 `data/knowledge.json` 与 `site/data/knowledge.json` SHA256 均为 `4a99eba7337bcbbb32dba0a29bec4b975d117950f7325555a58402c53e2a2ca4`；导入包 SHA256 为 `02db58d0b07e851bc1282b9e9b765cdc85830a67d2bcc5f8586e59f5a837f147`。学校官网单校分数不替代任何省级考试院全量投档/录取表；正式省级缺口仍为西藏。

v3.258 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.258-national-school-official-nwnu2022-2025-818676records`，含 818676 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5069 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.258 新增 `data/admissions/official-national-school-admission-2025-v3258-nwnu-import.json`，从西北师范大学本科招生网官方历年分数查询 SPA 和 `zsdata.nwnu.edu.cn/lqxx/s` API 抽取 4012 条 2022-2025 年全国 31 省单校分专业录取最高分、平均分、最低分和最低位次记录，并保留 454 个 raw 证据文件。该源全部为 `major-admission`；3810 条公开最低分位次，202 条保持 `rankUnavailable=true`；普通学校官网边界 2717 条按 `school-official-only` 保存，中职/对口、协作计划、专项、民族班、艺术、中外合作、预科、内高班/西藏班/新疆班等 1295 条按 `special-path-only` 隔离；分数范围 296-652，最低位次范围 564-331240。运行镜像、本地 `data/knowledge.json` 与 `site/data/knowledge.json` SHA256 均为 `1ff5559d3bc4a0835913acf4e1c78ad47945caa03d69a70a043b2677bf88cc51`；导入包 SHA256 为 `f24e9f4e12ec217c9a332152c0b3f2ad05e39fcc609f504e6bd0e0fb56f6b819`。学校官网单校分数不替代任何省级考试院全量投档/录取表；正式省级缺口仍为西藏。

v3.257 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.257-national-school-official-tju2025-814664records`，含 814664 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5068 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.257 新增 `data/admissions/official-national-school-admission-2025-v3257-tju-import.json`，从天津大学本科招生网官方历年分数查询 SPA 和 `zsdata.tju.edu.cn/lqxx/s` API 抽取 379 条 2025 年全国 31 省单校分专业/概况录取最高分、平均分、最低分记录，并保留 125 个 raw 证据文件。该源含 `major-admission` 263 条、`institution-admission` 116 条；源表未公开最低位次，379 条全部保持 `rankUnavailable=true`；普通学校官网边界 223 条按 `school-official-only` 保存，国家专项、高校专项、民族班等 156 条按 `special-path-only` 隔离；分数范围 385-746，普通学校官网边界异常分为 0。运行镜像、本地 `data/knowledge.json` 与 `site/data/knowledge.json` SHA256 均为 `185b0cb806be87ccfb411405952fa595ccb3091d8acda2c3fa4329c4be44288c`；导入包 SHA256 为 `1a1a1d316ea2b5c9d06ba4a403898f9a46fafa9f255d7f628f7139929e27e011`。学校官网单校分数不替代任何省级考试院全量投档/录取表；正式省级缺口仍为西藏。

v3.256 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.256-national-school-official-xisu2021-2025-814285records`，含 814285 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5067 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.256 新增 `data/admissions/official-national-school-admission-2021-2025-v3256-xisu-import.json`，从西安外国语大学招生网官方历年分数查询 SPA 和 `zsdata.xisu.edu.cn/lqxx/s` API 抽取 4720 条 2021-2025 年全国 31 省单校分专业/概况录取最高分、平均分、最低分记录，并保留 481 个 raw 证据文件。该源含 `major-admission` 4248 条、`institution-admission` 472 条；源表未公开最低位次，4720 条全部保持 `rankUnavailable=true`；普通学校官网边界 3392 条按 `school-official-only` 保存，艺术、提前批、公费师范、专项、预科、中外合作、南疆单列、内高班/新疆班等 1328 条按 `special-path-only` 隔离；分数范围 195-744，普通学校官网边界异常分为 0。运行镜像、本地 `data/knowledge.json` 与 `site/data/knowledge.json` SHA256 均为 `a00c7351bc44e3f013ac90377b067b2602d29cd19d40473cbb2f59ff78bce0e3`；导入包 SHA256 为 `c234552e99afe146f7459d247b73304103a982f1510ad5a3265cc1247ce1bc24`。学校官网单校分数不替代任何省级考试院全量投档/录取表；正式省级缺口仍为西藏。

v3.255 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.255-national-school-official-xhu2023-2025-809565records`，含 809565 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5066 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.255 新增 `data/admissions/official-national-school-admission-2023-2025-v3255-xhu-import.json`，从西华大学招生网“历年分数查询”页、官方历年分数查询 SPA 和 `zsdata.xhu.edu.cn/lqxx/s` API 抽取 1521 条 2023-2025 年全国 29 省单校分专业录取最高分、平均分、最低分和部分最低分位次记录，并保留 341 个 raw 证据文件。该源全部为 `major-admission`；1370 条公开最低分位次，151 条保持 `rankUnavailable=true`；普通学校官网边界 1286 条按 `school-official-only` 保存，艺术、体育、预科、一类模式少数民族预科等 235 条按 `special-path-only` 隔离；分数范围 63-631，最低位次范围 2733-449896，10 条低于 150 的记录均为艺术/体育特殊计分，普通学校官网边界异常分为 0。运行镜像、本地 `data/knowledge.json` 与 `site/data/knowledge.json` SHA256 均为 `869d7188132e4a6fd42c05dee5bf0833fd22e9b7e0d6d70856942e0e9f21a3c0`；导入包 SHA256 为 `686a4ca4fc97c23592d5588c95804e85eb6ad09dd91faa11f19700cdb791d2e5`。学校官网单校分数不替代任何省级考试院全量投档/录取表；正式省级缺口仍为西藏。

v3.254 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.254-national-school-official-lzjtu2025-808044records`，含 808044 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5065 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.254 新增 `data/admissions/official-national-school-admission-2025-v3254-lzjtu-import.json`，从兰州交通大学官方历年分数查询 SPA 和 `zsdata.lzjtu.edu.cn/lqxx/s` API 抽取 1543 条 2025 年全国 31 省单校分专业/概况录取最高分、平均分、最低分和部分最低分位次记录，并保留 89 个 raw 证据文件。该源含 `major-admission` 1462 条、`institution-admission` 81 条；1456 条公开最低分位次，87 条保持 `rankUnavailable=true`；普通学校官网边界 1332 条按 `school-official-only` 保存，国家/地方专项、预科、八协计划、西藏班、新疆班、民族专项、南疆单列等 211 条按 `special-path-only` 隔离；分数范围 307-631，最低位次范围 1505-301252，异常分为 0。运行镜像、本地 `data/knowledge.json` 与 `site/data/knowledge.json` SHA256 均为 `ec0536b3322729f4d7c3220ff0ac0a493e57d065a95e05ed4bfde8e6a203aac2`；导入包 SHA256 为 `f5a5d0bc7195cbdf1f70bab75cddca5395a84b494ef300d5573e0550d668c0e1`。学校官网单校分数不替代任何省级考试院全量投档/录取表；正式省级缺口仍为西藏。

v3.253 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.253-national-school-official-ecust2022-2025-806501records`，含 806501 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5064 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.253 新增 `data/admissions/official-national-school-admission-2022-2025-v3253-ecust-import.json`，从华东理工大学官方历年分数查询 SPA 和 `bkzsdata.ecust.edu.cn/lqxx/s` API 抽取 4698 条 2022-2025 年全国 31 省单校分专业录取最高分/平均分/最低分记录，并保留 604 个 raw 证据文件。该源含 `major-admission` 4083 条、`institution-admission` 615 条；1140 条公开最低分位次，3558 条保持 `rankUnavailable=true`；普通学校官网边界 2316 条按 `school-official-only` 保存，艺术、专项、综合评价、民族班、西藏/新疆路径等 2382 条按 `special-path-only` 隔离；分数范围 78.036096718-810.89，16 条低于 150 或高于 750 的记录均为艺术类综合分特殊计分，普通学校官网边界异常分为 0。运行镜像、本地 `data/knowledge.json` 与 `site/data/knowledge.json` SHA256 均为 `391013170691cb61f03fa906168e558ac731ecc5b7f52c81371471795f2a3f30`；导入包 SHA256 为 `280dbbb89e0deadabafd4cc18c77d4f0478c442ddd783fc6ba06a2a9c4ab2661`。学校官网单校分数不替代任何省级考试院全量投档/录取表；正式省级缺口仍为西藏。

v3.252 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.252-national-school-official-swufe2023-2025-801803records`，含 801803 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5063 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.252 新增 `data/admissions/official-national-school-admission-2023-2025-v3252-swufe-import.json`，从西南财经大学官方“本科专业历年分数线查阅”页、官方历年分数查询 SPA 和 `zsdata.swufe.edu.cn/lqxx/s` API 抽取 4907 条 2023-2025 年全国 31 省单校分专业录取最高分/最低分记录，并保留 601 个 raw 证据文件。该源含 `major-admission` 4314 条、`institution-admission` 593 条；源 API 未公开最低位次，4907 条全部保持 `rankUnavailable=true`；普通学校官网边界 3208 条按 `school-official-only` 保存，艺术、专项、中外合作、预科、内地西藏班、内地新疆班、南疆单列等 1699 条按 `special-path-only` 隔离；分数范围 231-799，4 条高于 750 的记录均为河南艺术类综合分特殊计分，普通学校官网边界异常分为 0。运行镜像、本地 `data/knowledge.json` 与 `site/data/knowledge.json` SHA256 均为 `0e926b0187114f19ab960c71dd3687b69a8b7ec4ba486da9891d4de467e7a175`；导入包 SHA256 为 `db607ed0b3c3b2a26ff5b23c0dd2871dc80d7e159314bd9225fceb5d657ef87a`。学校官网单校分数不替代任何省级考试院全量投档/录取表；正式省级缺口仍为西藏。

v3.251 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.251-national-school-official-xupt2023-2025-796896records`，含 796896 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5062 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.251 新增 `data/admissions/official-national-school-admission-2023-2025-v3251-xupt-import.json`，从西安邮电大学本科招生信息网“计划分数”页、官方历年分数查询 SPA 和 `zsdata.xupt.edu.cn/lqxx/s` API 抽取 2370 条 2023-2025 年全国 31 省单校分专业录取最低分/最低分位次记录，并保留 295 个 raw 证据文件。该源含 `major-admission` 2083 条、`institution-admission` 287 条；2189 条公开最低分位次，181 条保持 `rankUnavailable=true`；普通学校官网边界 1992 条按 `school-official-only` 保存，艺术、专项、中外合作、单列/南疆等 378 条按 `special-path-only` 隔离；分数范围 236-658，低于 150 或高于 750 的异常分为 0。运行镜像、本地 `data/knowledge.json` 与 `site/data/knowledge.json` SHA256 均为 `9bcbf9bb4ac2bc9ed31ab19e9b5aeca02d29159fc78d4649110cc85549fb462f`；导入包 SHA256 为 `5b94f10f07deb6d2f3afed63717c829c76eb6c6334be0cd5524c4ae696fe749d`。学校官网单校分数不替代任何省级考试院全量投档/录取表；正式省级缺口仍为西藏。

v3.250 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.250-national-school-official-chd2023-2025-794526records`，含 794526 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5061 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.250 新增 `data/admissions/official-national-school-admission-2023-2025-v3250-chd-import.json`，从长安大学本科招生网、官方历年分数查询 SPA 和 `zsdata.chd.edu.cn/lqxx/s` API 抽取 4560 条 2023-2025 年全国 31 省单校分专业录取最低分/最低分位次记录，并保留 487 个 raw 证据文件。该源全部为 `major-admission`；2768 条公开最低分位次，1792 条保持 `rankUnavailable=true`；普通学校官网边界 3159 条按 `school-official-only` 保存，体育、艺术、专项、中外合作、预科、西藏/新疆路径等 1401 条按 `special-path-only` 隔离；低于 150 或高于 750 的 16 条均为体育类特殊计分，普通学校官网边界无异常分污染。运行镜像、本地 `data/knowledge.json` 与 `site/data/knowledge.json` SHA256 均为 `199644d671cbcd090bf76f0934671f0d3a6c2e92ba963ffee93816af0abcce92`；导入包 SHA256 为 `f66c4b0fe1e5c4c8a7a82565ca2611e4c0776718e94c2d997706437cc4faac9e`。学校官网单校分数不替代任何省级考试院全量投档/录取表；正式省级缺口仍为西藏。

v3.249 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.249-national-school-official-xauat2020-2025-789966records`，含 789966 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5060 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.249 新增 `data/admissions/official-national-school-admission-2020-2025-v3249-xauat-import.json`，从西安建筑科技大学本科招生信息网、官方历年分数查询 SPA 和 `zsdata.xauat.edu.cn/lqxx/s` API 抽取 4212 条 2020-2025 年全国 31 省单校分专业录取最低分/最低分位次记录，并保留 616 个 raw 证据文件。该源全部为 `major-admission`；545 条公开最低分位次，3667 条保持 `rankUnavailable=true`；普通学校官网边界 3540 条按 `school-official-only` 保存，艺术、体育、专项、中外合作、定向、新疆班等 672 条按 `special-path-only` 隔离；低于 150 或高于 750 的 27 条均为艺术/体育特殊计分，普通学校官网边界无异常分污染。运行镜像、本地 `data/knowledge.json` 与 `site/data/knowledge.json` SHA256 均为 `7fd530256467c1a324ffb09f290936461521bb171dd16ca06178456df2c3fbac`；导入包 SHA256 为 `a29950ae626ed763395650b9f4d5e4817acd72182a66b50bfa7bdc44ec5fb079`。学校官网单校分数不替代任何省级考试院全量投档/录取表；正式省级缺口仍为西藏。

v3.248 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.248-national-school-official-xust2023-2025-785754records`，含 785754 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5059 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.248 新增 `data/admissions/official-national-school-admission-2023-2025-v3248-xust-import.json`，从西安科技大学信息公开页、官方历年分数查询 SPA 和 `zsdata.xust.edu.cn/lqxx/s` API 抽取 2562 条 2023-2025 年全国 31 省单校分专业录取最低分/最低分位次记录，并保留 372 个 raw 证据文件。该源全部为 `major-admission`；2296 条公开最低分位次，266 条保持 `rankUnavailable=true`；普通学校官网边界 2188 条按 `school-official-only` 保存，艺术、专项、预科、新疆班、单列/南疆、定向/援疆、中外合作等 374 条按 `special-path-only` 隔离；低于 150 或高于 750 的 4 条均为艺术类特殊计分，普通学校官网边界无异常分污染。运行镜像、本地 `data/knowledge.json` 与 `site/data/knowledge.json` SHA256 均为 `e7966ffc70b96862f38c514c1a89b20249c84745070da152a0e101983a2bde01`；导入包 SHA256 为 `59b103bcd786879c55962e47f7f9df236a7f1de4b8004f3e618e9d282ae36a04`。学校官网单校分数不替代任何省级考试院全量投档/录取表；正式省级缺口仍为西藏。

v3.247 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.247-national-school-official-ujs2021-2025-783192records`，含 783192 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5058 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.247 新增 `data/admissions/official-national-school-admission-2021-2025-v3247-ujs-import.json`，从江苏大学本科招生网官方“历年分数”HTML 表格抽取 6090 条 2021-2025 年全国 31 省单校分专业录取最低分记录，并保留 188 个 raw 证据文件。该源全部为 `major-admission`；源表未公开最低位次，6090 条全部保持 `rankUnavailable=true`；普通学校官网边界 5182 条按 `school-official-only` 保存，艺术体育、国家/地方/贫困专项、定向、南疆单列、中外合作、学分互认/联合培养等 908 条按 `special-path-only` 隔离；HTML 表格 rowspan/colspan 已展开，省控线斜杠口径只保留原文。运行镜像、本地 `data/knowledge.json` 与 `site/data/knowledge.json` SHA256 均为 `240881a812ad2acb969d0efb66c0535fb7a6fd8d08b88b2d80bb2d73753a59cf`；导入包 SHA256 为 `eb9e6196ec50ac29216a42e82c590fc1fa53535309e77dcbef837e3ddb5e385a`。学校官网单校分数不替代任何省级考试院全量投档/录取表；正式省级缺口仍为西藏。

v3.246 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.246-national-school-official-cqu2023-2025-777102records`，含 777102 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5057 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.246 新增 `data/admissions/official-national-school-admission-2023-2025-v3246-cqu-import.json`，从重庆大学招生办公室官网历年分数查询页、查询条件接口和全量数据接口抽取 1996 条 2023-2025 年全国 31 省单校分专业录取最低分记录，并保留 10 个 raw 证据文件。该源全部为 `major-admission`；源表未公开最低位次，1996 条全部保持 `rankUnavailable=true`；西藏新增 26 条，新疆新增 142 条。普通学校官网边界 899 条按 `school-official-only` 保存，国家专项、高校专项、民族班、南疆/新疆协作计划、中外合作、艺术、提前批等 1097 条按 `special-path-only` 隔离；源表同时含“录取线”和“最低分”，运行层只用“最低分”作为 `minScore`，并把“录取线”保留为审计字段。学校官网单校分数不替代任何省级考试院全量投档/录取表。

v3.245 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.245-national-school-official-hnust2021-2025-775106records`，含 775106 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5056 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.245 新增 `data/admissions/official-national-school-admission-2021-2025-v3245-hnust-import.json`，从湖南科技大学本科招生网历年各省录取分数线、历年各专业录取分数线和官方静态 JSON 抽取 9650 条 2021-2025 年全国 31 省单校录取边界，并保留 5 个 raw 证据文件。该源含 `major-admission` 9203 条、`institution-admission` 447 条；源表未公开最低位次，9650 条全部保持 `rankUnavailable=true`；西藏新增 32 条，新疆新增 165 条。普通学校官网边界 7982 条按 `school-official-only` 保存，专项、提前批、艺术体育等 1668 条按 `special-path-only` 隔离；香港、台湾、港澳台联招只作 skipped audit。学校官网单校分数不替代任何省级考试院全量投档/录取表。

v3.244 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.244-national-school-official-zstu2024-2025-765456records`，含 765456 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5055 条来源说明。v3.244 新增 `data/admissions/official-national-school-admission-2024-2025-v3244-zstu-import.json`，从浙江理工大学本科招生网官方历年分数系统 `https://zsdata.zstu.edu.cn/zsdata/lqxx/#/lnfs` 与 `https://zsdata.zstu.edu.cn/lqxx/s` 官方 API 抽取 771 条 2024-2025 年全国 30 省单校分专业录取边界，并保留 139 个 raw 证据文件。该源全部为 `major-admission`；381 条公开最低位次，390 条保持 `rankUnavailable=true`；西藏新增 17 条，新疆新增 48 条，宁夏源系统无记录。普通学校官网边界 708 条按 `school-official-only` 保存，中外合作、艺术类、内高班等 63 条按 `special-path-only` 隔离。学校官网单校分数不替代任何省级考试院全量投档/录取表。

v3.243 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.243-national-school-official-muc2022-2025-764685records`，含 764685 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5054 条来源说明。v3.243 新增 `data/admissions/official-national-school-admission-2022-2025-v3243-muc-import.json`，从中央民族大学本科招生网官方“录取分数”页面 `https://zb.muc.edu.cn/content/zs/7fd7b6c2-f0de-11ee-a4af-00163e36a0b0.htm` 的 AJAX 接口抽取 4398 条 2022-2025 年全国 31 省单校录取边界，并保留 1742 个 raw 证据文件。该源含录取概况 648 条、分专业 3750 条；3909 条公开最低位次，489 条保持 `rankUnavailable=true`；西藏新增 63 条，新疆新增 164 条。普通学校官网边界 3236 条按 `school-official-only` 保存，艺术类、体育类、合作办学等 1162 条按 `special-path-only` 隔离；2025 年西藏 20 条已由既有 MUC 窄源导入，本轮显式跳过避免重复。学校官网单校分数不替代任何省级考试院全量投档/录取表。

v3.242 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.242-national-school-official-fzu2018-2025-760287records`，含 760287 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5053 条来源说明。v3.242 新增 `data/admissions/official-national-school-admission-2018-2025-v3242-fzu-import.json`，从福州大学招生考试中心官网 `https://zsks.fzu.edu.cn/` 和官方“历年录取”页面 `https://zsks2.fzu.edu.cn/linianluqu/?zssf-0,zxkl-0=,p-1,o-1` 抽取 6101 条 2018-2025 年全国 31 省单校专业录取边界，并保留 371 个 raw 证据文件。该源全部为 `major-admission`，源系统未公开最低位次，6101 条均保持 `rankUnavailable=true`；西藏新增 63 条，新疆新增 134 条。普通学校官网边界 3771 条按 `school-official-only` 保存，艺术类、专项、闽台合作、中外合作、地矿类、预科、定向等 2330 条按 `special-path-only` 隔离；官网分页存在跨页重复行，导入时按稳定 ID 去重 1256 条；第 132、341 页为站内“招生计划”表，整页作为审计跳过。

v3.241 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.241-national-school-official-zjut2021-2025-754186records`，含 754186 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5052 条来源说明。v3.241 新增 `data/admissions/official-national-school-admission-2021-2025-v3241-zjut-import.json`，从浙江工业大学本科招生网官方“历年录取查询系统” `https://zs.zjut.edu.cn/jsp/lnzssearch.jsp` 和官方 `zs.zjut.edu.cn/lncjList.action` 接口抽取 2154 条 2021-2025 年全国 31 省单校专业录取边界，并保留 777 个 raw 证据文件。该源全部为 `major-admission`，源系统未公开最低位次，2154 条均保持 `rankUnavailable=true`；西藏新增 29 条，新疆新增 49 条。普通学校官网边界 1654 条按 `school-official-only` 保存，国家专项、三位一体、艺术类、新疆班、中外合作等 500 条按 `special-path-only` 隔离；艺术类和三位一体保留官网综合分列，不与普通文化分混算，普通类 `工业设计` 不误归为艺术类。

v3.240 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.240-national-school-official-zjnu2023-2025-752032records`，含 752032 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5051 条来源说明。v3.240 新增 `data/admissions/official-national-school-admission-2023-2025-v3240-zjnu-import.json`，从浙江师范大学招生办公室官方“历年分数”查询系统和官方 `lqcx.zjnu.edu.cn/lqxx/s` API 抽取 2083 条 2023-2025 年全国 31 省单校专业录取边界；配置接口自标识 `xxmc=浙江师范大学`，并给出招生网链接 `http://zs.zjnu.edu.cn/`。该源全部为 `major-admission`，1672 条公开最低位次，411 条保持 `rankUnavailable=true`；西藏新增 62 条，新疆新增 132 条。普通学校官网边界 1557 条按 `school-official-only` 保存，中外合作、艺术体育、国家专项、提前批、预科、内高班/西藏班、定向等 526 条按 `special-path-only` 隔离；港澳台侨联招查询键未进入 31 省运行层。

v3.239 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.239-national-school-official-xjtu2022-2025-749949records`，含 749949 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5050 条来源说明。v3.239 新增 `data/admissions/official-national-school-admission-2022-2025-v3239-xjtu-import.json`，从西安交通大学招生办公室官方“历年分数”查询系统和官方 `zswxxcx.xjtu.edu.cn/lqxx/s` API 抽取 2979 条 2022-2025 年全国 31 省单校专业录取边界；配置接口自标识 `xxmc=西安交通大学`，并给出招生网链接 `https://zs.xjtu.edu.cn/`。该源全部为 `major-admission`，1383 条公开最低位次，1596 条保持 `rankUnavailable=true`；西藏新增 11 条，新疆新增 70 条。普通学校官网边界 2103 条按 `school-official-only` 保存，中外合作、国家专项、高校专项、提前文、预科、单列、南疆等 876 条按 `special-path-only` 隔离。

v3.238 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.238-national-school-official-uestc2021-2025-746970records`，含 746970 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5049 条来源说明。v3.238 新增 `data/admissions/official-national-school-admission-2021-2025-v3238-uestc-import.json`，从电子科技大学本科招生网直连的“历年分数”应用和官方 `chaxun.uestc.edu.cn/lqxx/s` API 抽取 3149 条 2021-2025 年全国 31 省单校专业录取边界。源表未公开最低位次，3149 条均保持 `rankUnavailable=true`；西藏新增 25 条，新疆新增 92 条。普通学校官网边界 2484 条按 `school-official-only` 保存，国家专项、高校专项、预科、单列/南疆、中外合作等 665 条按 `special-path-only` 隔离；电子信息工程（科技与艺术联合学位实验班）按普通录取保留，不误归为艺术类。

v3.237 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.237-national-school-official-wust2022-2025-743821records`，含 743821 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5048 条来源说明。v3.237 新增 `data/admissions/official-national-school-admission-2022-2025-v3237-wust-import.json`，从武汉科技大学本科招生网首页直连的“历年分数”应用和官方 `zsdata.wust.edu.cn/lqxx/s` API 抽取 2355 条 2022-2025 年全国 30 省单校录取边界，其中专业录取 2078 条、录取概况 277 条，2094 条公开最低位次、261 条保持 `rankUnavailable=true`；新疆新增 63 条。普通学校官网边界 2112 条按 `school-official-only` 保存，艺术体育、专项、预科、中外合作等 243 条按 `special-path-only` 隔离；低于 200 分的 8 条全部为体育批特殊计分口径。

v3.236 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.236-national-school-official-hnucm2024-2025-741466records`，含 741466 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5047 条来源说明。v3.236 新增 `data/admissions/official-national-school-admission-2024-2025-v3236-hnucm-import.json`，从湖南中医药大学本科招生网官方导航页和官方 API 抽取 2069 条 2024-2025 年全国 31 省单校录取边界，其中专业录取 1841 条、录取概况 228 条，1949 条公开最低位次、120 条保持 `rankUnavailable=true`；西藏新增 18 条，新疆新增 90 条。普通学校官网边界 1861 条按 `school-official-only` 保存，艺术体育、专项、预科、内高班、西藏班、单列、南疆、定向/援疆等 208 条按 `special-path-only` 隔离。

v3.235 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.235-national-school-official-utibet2023-2025-739397records`，含 739397 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5046 条来源说明。v3.235 新增 `data/admissions/official-national-school-admission-2023-2025-v3235-utibet-import.json`，从西藏大学招生就业处“历年分数”公开页面和官方 API 抽取 1719 条 2023-2025 年分省分专业最低分，覆盖 26 省；其中西藏 323 条，普通 `school-official-only` 167 条，国家专项、地方专项、部队专项、边境专项、西藏班和提前批艺术类本科等 156 条按 `special-path-only` 隔离。该源未公开最低位次，全部新增行 `rankUnavailable=true`，不生成假位次或录取概率。

v3.233 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.233-national-school-official-xupt2021-2022-734529records`，含 734529 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5044 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.233 新增 `data/admissions/official-national-school-plan-score-2021-2022-v3233-xupt-import.json`，从西安邮电大学本科招生信息网官方“计划分数”31 个分省分专业页面抽取 2022 年招生计划与 2021 年录取情况，结构化 1356 条单校计划/分数边界：`admission-plan` 712 条、`major-admission` 644 条；录取分数层中 `school-official-only` 621 条、`special-path-only` 23 条；物理类 1032 条、历史类 190 条、综合 127 条、艺术类 7 条；分数范围 218-632。陕西页保留 101 条官网最低位次，其余 543 条录取行保持 `rankUnavailable=true`；西藏新增 27 条西安邮电大学官网单校计划/分数边界（其中录取 9 条），新疆新增 49 条（其中录取 23 条）。2022 招生计划只作专业池和计划数约束，不参与录取最低分、投档线或概率计算；学校官网单校分数不替代任何省级考试院全量投档/录取表；正式省级缺口仍为西藏。

v3.232 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.232-national-school-official-xidian2022-2025-733173records`，含 733173 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5043 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.232 新增 `data/admissions/official-national-school-admission-2022-2025-v3232-xidian-import.json`，从西安电子科技大学本科招生网官方“历年分数”接口抽取 2022-2025 年 31 省分专业录取分数，结构化 1892 条单校专业边界：`major-admission` 1892 条；`school-official-only` 1137 条、`special-path-only` 755 条；物理类 1559 条、历史类 114 条、综合 219 条；分数范围 356-745。1828 条公开最低分位次，位次范围 520-47104，64 条未公开最低位次并保持 `rankUnavailable=true`。西藏新增 31 条西安电子科技大学 2022-2025 官网单校分数，新疆新增 49 条；国家专项、高校专项和分数字段含“区内”的行均按 `special-path-only` 隔离。不生成假位次或录取概率。该层只用于西安电子科技大学候选边界复核、电子信息/计算机方向趋势和西藏/新疆单校分数加厚，不替代西藏自治区、新疆或任何省级考试院全量投档/录取表。

v3.231 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.231-national-school-official-ncepu-baoding2025-731281records`，含 731281 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5042 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.231 新增 `data/admissions/official-national-school-admission-2025-v3231-ncepu-baoding-import.json`，从华电（保定）招生信息网官方“历年录取分数”页面的静态 JSON 抽取 2025 年 31 省总体录取分数和各专业录取分数，结构化 1272 条单校边界：`institution-admission` 106 条、`major-admission` 1166 条；`school-official-only` 956 条、`special-path-only` 316 条；物理类 984 条、历史类 117 条、综合 170 条、艺术类 1 条；分数范围 383-713。1224 条公开最低分位次，位次范围 672-65709，48 条未公开最低位次并保持 `rankUnavailable=true`。西藏新增 9 条华北电力大学（保定）2025 官网单校分数，新疆新增 37 条；源表显式 `469（汉）/412（藏）` 已拆成汉/藏口径，藏口径、艺术类、专项和定向就业均按 `special-path-only` 隔离。不生成假位次或录取概率。该层只用于华北电力大学（保定）候选边界复核、电力/工科方向趋势和西藏/新疆单校分数加厚，不替代西藏自治区、新疆或任何省级考试院全量投档/录取表。

v3.230 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.230-national-school-official-neepu2021-2025-730009records`，含 730009 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5041 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.230 新增 `data/admissions/official-national-school-admission-2021-2025-v3230-neepu-import.json`，从东北电力大学招生信息网官方“历年分数” OpenApp 查询组件抽取 2021-2025 年 31 省 155 个省年 JSON 原始回包，结构化 4131 条单校分专业录取边界：`school-official-only` 3741 条、`special-path-only` 390 条；物理类 3190 条、历史类 212 条、综合 438 条、艺术类 229 条、体育类 61 条；分数范围 42-666，其中低于 150 分的 55 条全部为艺术/体育特殊计分口径并已按 `special-path-only` 隔离；3715 条公开最低分位次，位次范围 143-509762，416 条未公开最低位次并保持 `rankUnavailable=true`。西藏新增 20 条东北电力大学 2021-2025 官网单校分数，最低分 296-451，其中普通单校边界 18 条、特殊路径 2 条；不生成假位次或录取概率。该层只用于东北电力大学候选边界复核、工科/电力方向跨年趋势和西藏单校分数加厚，不替代西藏自治区或任何省级考试院全量投档/录取表。

v3.229 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.229-national-school-official-cust2017-2025-725878records`，含 725878 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5040 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.229 新增 `data/admissions/official-national-school-admission-2017-2025-v3229-cust-import.json`，从长春理工大学本科招生网官方“历年录取分数查询”静态 HTML 页抽取 2017-2025 年 31 省单校分专业录取边界 10452 条：`school-official-only` 9045 条、`special-path-only` 1407 条；物理类 5916 条、历史类 1066 条、综合 1489 条、艺术类 138 条、官网未列科类 1837 条；分数范围 206-734，低于 300 分 26 条。西藏新增 58 条长春理工大学 2017-2025 本科一批官网单校分数，最低分 293-524；源表未公开最低位次，全部 `rankUnavailable=true`，不生成假位次或录取概率。该层只用于长春理工大学候选边界复核、跨年趋势和西藏单校分数加厚，不替代西藏自治区或任何省级考试院全量投档/录取表。

v3.228 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.228-henan-2024-undergraduate2-third-party-content-mirror-715426records`，含 715426 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5039 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.228 新增 `data/admissions/third-party-content-mirror-henan-undergraduate2-filing-2024-6617-import.json`，在河南省教育考试院官方文章、HAEEA 数据中心文科/理科查询入口和 EOL 官方链接镜像已定位但命令行访问仍返回验证页的情况下，使用 6617.com 转载图片表经 macOS Vision OCR 与固定列抽取导入 1938 条河南 2024 本科二批院校投档 score+rank 边界：文科 828 条，分数 427-534，最低位次 19197-98536；理科 1110 条，分数 392-565，最低位次 55035-336443。该层是 `third-party-content-mirror`，不是考试院直连 official，也不是 `official-content-mirror`；2024 河南仍为旧文理口径，不能与 2025 以后物理/历史新高考直接混用，也不能替代专业录取结果或录取概率。v3.226/v3.227 的 1076 条河南 2024 本科一批文理投档边界继续保留；正式省级缺口仍为西藏，河南仍需追考试院直连本科二批附件、2025 新高考本科批和高职高专全量表。

v3.227 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.227-henan-2024-undergraduate1-liberal-official-content-mirror-713488records`，含 713488 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5038 条来源说明。v3.227 新增 `data/admissions/official-content-mirror-henan-undergraduate1-liberal-filing-2024-zizzs-import.json`，从河南省教育考试院官方文章链接到的 HAEEA 数据中心文科表与自主选拔在线镜像图片导入 395 条河南 2024 本科一批文科院校投档 score+rank 边界：分数 524-658，最低位次 36-24082；第 5 张镜像图与第 4 张 SHA 相同并已跳过。v3.226 的 681 条河南 2024 本科一批理科同层记录继续保留。该层是 `official-content-mirror`，不是数据中心直连 official。

v3.189 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.189-national-school-official-dlut2025-672953records`，含 672953 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、5000 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.189 新增 `data/admissions/official-national-school-admission-2025-v3189-dlut-import.json`，从大连理工大学本科生招生网官方“录取分数”动态查询页、前端分块和 7 个 `apiV2025` JSON 接口抽取 906 条 2025 年单校录取分数边界：`institution-admission` 201 条、`major-admission` 705 条；主校区（含开发区校区）652 条、盘锦校区 254 条；物理类 692 条、历史类 101 条、综合 113 条。普通学校官网单校边界 615 条按 `school-official-only` 保存，国家专项、高校专项、民族/预科、内高班/单列、艺术体育等 291 条按 `special-path-only` 隔离；源系统未公开最低位次，运行层不生成假位次、不凭单校行输出录取概率。正式省级缺口仍为西藏。

v3.188 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.188-national-school-official-suda2023-2025-672047records`，含 672047 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、4999 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.188 新增 `data/admissions/official-national-school-admission-2023-2025-v3188-suda-import.json`，从苏州大学本科招生网官方“历年分数”页面和 97 个原始 HTML 证据页抽取 4422 条单校录取分数边界：`major-admission` 4033 条、`major-group-admission` 307 条、`institution-admission` 82 条；2023 年 1621 条、2024 年 1641 条、2025 年 1160 条；历史类 897 条、物理类 2544 条、综合 500 条、艺术类 468 条、体育类 13 条。普通学校官网单校边界 3941 条按 `school-official-only` 保存，艺术类、体育类等 481 条按 `special-path-only` 隔离；源表未公开最低位次，运行层不生成假位次、不凭单校行输出录取概率。西藏 2023/2025 专业分数详情页无可解析表格，已作为 raw 审计记录保留；正式省级缺口仍为西藏。

v3.187 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.187-national-school-official-njust2023-2026-667625records`，含 667625 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、4998 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.187 新增 `data/admissions/official-national-school-plan-score-2023-2026-v3187-njust-import.json`，从南京理工大学本科招生信息网官方“2026年招生计划及近三年录取分数线查询”页面、`lqScore/initDateWebCon` 和 `lqPain/initDateCon` 接口抽取 2679 条单校记录：2023 年 477 条、2024 年 509 条、2025 年 708 条专业最低分，2026 年 985 条招生计划。普通学校官网单校/计划边界 2208 条按 `school-official-only` 保存，国家专项、高校专项、民族/预科、内高班、南疆单列、艺术类等 471 条按 `special-path-only` 隔离；西藏 2024 年 3 个斜线双分数格已拆成 6 条候选类别记录并标注 `candidateCategory=源表斜线分数第1/2项（含义未公开）`。源分数线无最低位次，也未公开科类/选科，运行层不生成假位次、不把该表作为精确选科匹配依据；2026 计划只作专业池、计划数、选科和学费约束，不参与投档线、录取最低分或概率；正式省级缺口仍为西藏。

v3.186 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.186-national-school-official-whut2018-2025-664946records`，含 664946 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、4997 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.186 新增 `data/admissions/official-national-school-admission-2018-2025-v3186-whut-import.json`，从武汉理工大学本科招生网官方“历年分数”动态查询页、`loaddata_lqqk.js` 和三个公开查询接口抽取 9719 条单校分数/位次边界，覆盖 31 省与 2018-2025 年；其中 `institution-admission` 883 条、`major-admission` 8836 条，8904 条公开位次值，815 条无可计算位次。普通学校官网单校边界 9325 条按 `school-official-only` 保存，国家专项、高校专项、民族/考生类别、艺术体育、提前批/航海等 394 条按 `special-path-only` 隔离；西藏 78 条保留 A/B 类 `candidateCategory` 与 `sourceSubjectRaw`，只加厚武汉理工大学在藏候选边界复核。

v3.185 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.185-national-school-official-hust2024-2025-655227records`，含 655227 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、4996 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.185 新增 `data/admissions/official-national-school-admission-2024-2025-v3185-hust-import.json`，从华中科技大学本科生招生信息网官方 2024、2025 年本科招生录取情况统计 HTML 表抽取 405 条单校分数边界，覆盖 31 省；2024 年 190 条、2025 年 215 条，其中普通批和中外合作办学 209 条按 `school-official-only` 保存，国家专项、高校专项、艺术类、提前批轮机工程、民族班、内地西藏/新疆高中班和少数民族类别 196 条按 `special-path-only` 隔离。源表无最低位次，部分行仅给出科类批次/类别名称而未明示精确选科；本层不生成假位次或仅凭该层输出录取概率，只加厚华中科技大学候选边界复核，不能替代任何省级教育考试院全量投档/录取分数表。

v3.184 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.184-national-school-official-zju2024-2025-654822records`，含 654822 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、4995 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.184 新增 `data/admissions/official-national-school-admission-2024-2025-v3184-zju-import.json`，从浙江大学本科招生网官方 2024、2025 年各省份普通本一批投档分数线 HTML 表抽取 230 条单校分数边界，覆盖 31 省；其中理工/文史合并选科行 24 条、医药列 54 条、备注项目 54 条，全部按 `school-official-only` 保存。源表无最低位次，并说明分数仅供参考、具体以各省份考试院公布为准；备注列未明示科类/选科，医药列需回到省级专业组和招生章程核验。本层不生成假位次或仅凭该层输出录取概率，只加厚浙江大学候选边界复核，不能替代任何省级教育考试院全量投档/录取分数表。

v3.183 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.183-national-school-official-fudan2024-2025-654592records`，含 654592 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、4994 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.183 新增 `data/admissions/official-national-school-admission-2024-2025-v3183-fudan-import.json`，从复旦大学招生网官方 2024、2025 年历年录取分数 HTML 表抽取普通批（本一批）、高校专项和国家专项全国分省分科类最低分 423 条；普通单校边界 194 条按 `school-official-only` 保存，专项及西藏少数民族行 229 条按 `special-path-only` 隔离，7 条上海 `580+` 只按最低下界保存。源表无最低位次，且说明 3+3 模式省份为便于查询按文史类/理工类简化归并；本层不生成假位次或仅凭该层输出录取概率，只加厚复旦大学候选边界复核。

v3.182 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.182-national-school-official-hit2024-2025-654169records`，含 654169 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、4993 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.182 新增 `data/admissions/official-national-school-admission-2024-2025-v3182-hit-import.json`，从哈尔滨工业大学本科招生网“录取分数”官方动态查询页面和同会话 `/information/score-list` 接口抽取 2024、2025 年 31 省专业最高分、平均分、最低分 2004 条；普通单校边界 1186 条按 `school-official-only` 保存，国家专项、高校专项、民族/少数民族、南疆单列、艺术/体育等 818 条按 `special-path-only` 隔离；源系统未公开最低位次，不生成假位次或仅凭该层输出录取概率。该层只加厚哈尔滨工业大学全国候选边界复核，不能替代任何省级教育考试院全量投档/录取分数表。

v3.181 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.181-xizang-school-official-cpu2025-652165records`，含 652165 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、4992 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.181 新增 `data/admissions/official-xizang-school-admission-2025-v3181-cpu-import.json`，从中国药科大学本科生招生网“历年录取分数”官方动态查询系统和 `_wp3services/generalQuery` 接口抽取 14 条西藏 2025 专业分数记录；普通录取 3 条按 `school-official-only` 保存，国家专项 2 条、高校专项 1 条、少数民族预科 3 条、西藏内高班 5 条按 `special-path-only` 隔离；源系统未公开最低位次，不生成假位次或录取概率。该层只加厚中国药科大学在藏候选边界，不能替代西藏自治区教育考试院全量投档/录取分数表，正式省级缺口仍为西藏；本轮全量 `scripts/build.mjs` 仍受当前 173 个 macOS `dataless` 占位 JSON 阻塞，运行层以 v3.180 为底增量注入 CPU 官方记录。

v3.180 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.180-national-school-official-ncut2010-652151records`，含 652151 条结构化录取/投档/计划/资格边界、116309 条位次换算记录、4991 条来源说明，覆盖 31 个省级口径和 2010、2011、2012、2013、2014 与 2015-2026 年。v3.180 新增 `data/admissions/official-national-school-admission-2010-v3180-ncut-import.json`，从北方工业大学招生网《2010年录取分数线》（2015-06-05 发布）官方 HTML 表解析 41 条全国单校旧文理调档分，覆盖 26 个归一省级口径、27 个源表行；源表无最低位次，全部为 score-only，分数范围 442-616，理工 27 条映射到站内物理类、文史 14 条映射到站内历史类，且保留 `sourceSubjectRaw` 与 `subjectMappingNote`；北京源表按 `一批` / `二批` 分列，运行层归一为省份 `北京`，并保留 `sourceProvinceLabel` 与 `admissionSubtype`；源表部分省份文史调档分为空白，导入器只保留可见调档分，不补造空白文史行；源表省份标签 `内蒙` 在运行层归一为 `内蒙古`，并保留 `sourceProvinceLabel=内蒙` 供审计回查；2010 源表不含西藏行，不生成西藏调档分、最低位次或概率；全部按 `school-official-only` 保存，源 HTML 只清理不可见字符，不补造源表不存在的行。本轮全量 `scripts/build.mjs` 因 `data/admissions` 下 163 个 macOS `dataless` 占位 JSON 读入阻塞而未闭合，运行层已从 v3.179 `knowledge.json` 增量注入 2010 官方记录并通过后续校验。

v3.179 的北方工业大学 2012 年全国校线 45 条、v3.178 的 2014 年全国校线 42 条、v3.177 的 2011 年全国校线 43 条、v3.176 的 2013 年全国校线 44 条、v3.175 的 2015 年全国校线 38 条、v3.174 的 2016 年全国校线 39 条、v3.173 的 2017 年全国校线 40 条、v3.172 的 2018 年全国校线 39 条、v3.171 的 2019 年全国校线 40 条、v3.170 的 2020 年全国校线 59 条、v3.169 的 2021 年全国校线 67 条、v3.168 的 2022 年全国校线 69 条、v3.167 的 2023 年全国校线 65 条、v3.166 的 2024 年全国校线 67 条、v3.165 的 2025 年非西藏全国校线 73 条继续保留，形成同校 2010/2011/2012/2013/2014/2015/2016/2017/2018/2019/2020/2021/2022/2023/2024/2025 对照；v3.164 的北方工业大学西藏汉族/少数民族 2 条 2025 单校文史调档线继续单独保留；v3.163 的厦门大学官方西藏报考指南 24 条、v3.162 的天津工业大学官方 HTML 表 12 条、v3.161 的四川农业大学官方历年分数查询系统 API 16 条、v3.160 的牡丹江医科大学和中北大学官方页面内嵌图片表、v3.159 的西藏民族大学、黑河学院、暨南大学西藏内地高中班和西交利物浦大学，v3.158 的东北石油大学、辽宁大学、西安理工大学、沈阳建筑大学、河南农业大学，v3.157 的深圳大学、福建理工大学、西北工业大学，以及 v3.156 的北京师范大学、闽南师范大学、中央民族大学单校官方分数继续保留。学校官网单校分数可加厚候选边界复核，但不参与 `formalScoreMissingProvinces` 省级全量闭合统计；征集、体育/播音、内地班、西藏班、对口高职、国家专项或无控制线等源表特殊入口只保留在特殊路径，不进入普通批文化分边界；未公开最低位次的记录不生成假位次或录取概率。严格按省级正式投档/录取类 official/chsi 或 official-content-mirror 且带 `minScore`、排除 `admission-plan`、`control-line`、`special-path-only` 与 `school-official-only` 的定义，当前普通正式分数表缺口仍只剩西藏。v3.154 曾新增吉林 2019 official/chsi 第一次投档分数 2759 条，补齐吉林 native `minScore` 的 official/chsi 投档分闭合，但年份为 2019 旧文理口径、原表无最低位次，仍需继续追吉林 2024-2026 新高考口径正式投档表、专业最低位次和最终专业录取分。v3.153 曾新增吉林 2021 CHSI 位次换算 1143 条，v3.152 曾新增吉林 2022 CHSI 位次换算 1092 条，v3.151 曾新增吉林 2023 EOL 官方内容镜像位次换算 1172 条；这些位次层只用于同年同原始科类分数到位次估算，不替代投档线、录取最低分或录取概率。

v3.129 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.129-qinghai-2024-vocational-m-final-rank-594085records`，含 594085 条结构化录取/投档/计划/资格边界、103783 条位次换算记录、4902 条来源说明。v3.129 新增 `data/admissions/official-qinghai-vocational-m-final-collection-rank-2024-import.json`，从青海省教育招生考试院发布、阳光高考转载的 2024 年普通高校招生普通专科批次（M段）最后一次征集志愿排序成绩一分一段统计 PDF 中抽取 512 条青海专科 M 段最后征集分数-位次换算记录；历史类 259 条（122-516 分、累计 2441 人），物理类 253 条（122-593 分、累计 1544 人），原表文史类/理工类已映射为站内历史类/物理类。PDF 原始文本层用 `pdftotext -raw` 直接抽取，总分、人数和累计数逐行校验；该层仅用于青海 2024 专科 M 段最后征集排序成绩位次换算，不替代普通全省一分一段、院校投档线、最终专业录取分或录取概率。

v3.128 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.128-anhui-2024-vocational-official-direct-images-594085records`，含 594085 条结构化录取/投档/计划/资格边界、103271 条位次换算记录、4901 条来源说明。v3.128 新增 `data/admissions/official-anhui-vocational-2024-direct-import.json`，把安徽省教育招生考试院 2024 年普通高职（专科）批院校投档分数及名次历史/物理官方页面直连落地，下载并校验 10 张官方图片表，以 official 同键记录覆盖旧镜像种子；运行层保留 1880 条安徽专科 score+rank 院校专业组投档边界，历史 876 条、物理 1004 条，分数 200-488，最低名次 2303-313410，低于 250 分 295 条、低于 300 分 633 条。结构化行沿用已通过固定列校验的 Vision OCR 结果，source note 保留官方页面/图片 URL、本地路径、sha256、尺寸和字节数；该层只作院校专业组进档边界，不替代最终专业录取结果。v3.127 的陕西 2026 控制线仍保留。严格按正式投档/录取类 official/chsi 或 official-content-mirror 且带 `minScore`、排除 `admission-plan`、`control-line` 与 `special-path-only` 的定义，普通正式分数表仍缺吉林、西藏。

v3.126 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.126-guizhou-2025-vocational-conscripts-official-pdf-594065records`，含 594065 条结构化录取/投档/计划/资格边界、103271 条位次换算记录、4898 条来源说明。v3.126 新增 `data/admissions/official-guizhou-vocational-conscripts-2025-import.json`，从贵州省招生考试院 2025 年高考普通类高职（专科）批第3次、第4次征集志愿投档情况官方 PDF 中抽取 267 条贵州专科征集志愿 score+rank 投档边界；物理类 167 条（190-441 分、最低位次 105672-204950），历史类 100 条（207-491 分、最低位次 25118-88333），其中一般统考生 263 条按 `ordinary-vocational-conscript-round` 使用，民族班、民汉双语民族班和中外合作办学 4 条按 `special-path-only` 隔离。该层只用于低分段补录/剩余计划阶段进档复核，不替代首轮普通高职（专科）批全量表、最终专业录取分或录取概率。

v3.125 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.125-guizhou-2025-vocational-advance-official-pdf-593798records`，含 593798 条结构化录取/投档/计划/资格边界、103271 条位次换算记录、4897 条来源说明。v3.125 新增 `data/admissions/official-guizhou-vocational-advance-2025-import.json`，从贵州省招生考试院 2025 年高考高职（专科）提前批录取情况官方 PDF 中抽取 194 条贵州提前批专业录取 score+rank 记录；物理类 114 条（199-534 分、最低位次 31100-204911），历史类 80 条（266-564 分、最低位次 6193-87476），覆盖定向培养军士生 128 条、航海类 50 条、其他提前批院校 16 条。该层全部标记 `formalScoreScope=special-path-only`，只用于提前批、定向培养军士、航海、司法警官、邮政等特殊路径进档/录取边界复核，不替代贵州普通高职（专科）批全量表，也不生成普通批录取概率。

v3.124 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.124-heilongjiang-2025-vocational-official-content-mirror-593604records`，含 593604 条结构化录取/投档/计划/资格边界、103271 条位次换算记录、4896 条来源说明。v3.124 新增 `data/admissions/official-heilongjiang-vocational-2025-import.json`，从标注来源为黑龙江教育考试院、公开转载页保留的 2025 年普通高校招生普通类高职（专科）批平行志愿投档分数线 XLSX 镜像中抽取 1206 条黑龙江专科院校专业组 score-only 投档边界；历史类 539 条（160-513 分，空投档 6 行只进审计），物理类 667 条（161-492 分，空投档 7 行只进审计），300 分以下新增 407 条。省考试院原附件直连需要验证码，因此该层按 `official-content-mirror-heilongjiang-vocational-filing-xlsx` 标注，只用于普通类高职（专科）批进档边界复核，不生成假位次或录取概率。

v3.123 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.123-qinghai-2025-rank-conversion-592398records`，含 592398 条结构化录取/投档/计划/资格边界、103271 条位次换算记录、4894 条来源说明。v3.123 新增 `data/admissions/official-qinghai-rank-conversion-2025-import.json`，从青海省教育招生考试院发布、阳光高考转载的 2025 普通高校招生考试排序成绩一分一段统计表（普通类）PDF 中抽取 963 条青海普通类分数-位次换算记录；历史类 482 条（0-637 分、累计 17212 人），物理类 481 条（0-661 分、累计 30457 人）。导入器同时识别 `637以上（含）`、`661分以上（含）` 和 `≥` 顶端边界写法，并用同分人数与累计人数差值逐行校验；该层只用于青海同年同科类位次换算，不当作录取线、投档线或录取概率。

v3.122 历史说明：`site/data/knowledge.json` 曾升至 `local-deterministic-v3.122-guizhou-2025-undergraduate-official-content-mirror-592398records`，含 592398 条结构化录取/投档/计划/资格边界、102308 条位次换算记录、4893 条来源说明。v3.122 新增 `data/admissions/official-guizhou-undergraduate-2025-import.json`，从标注信息来源为贵州省招生考试院的 2025 普通类本科批投档情况 PDF 镜像中抽取 24408 条贵州本科专业投档 score+rank 记录；物理类 18285 条，历史类 6123 条，分数 387-689，最低位次 5-158061，235 条空投档行只进入审计。国家专项、地方专项、民族班、预科、定向、少数民族语言类等限制入口按 `formalScoreScope=special-path-only` 隔离；中外合作办学保留费用和培养模式风险提示。

当前种子数据：

- `data/admissions/jiangxi-2025-seed.json`
- `data/admissions/dxsbb-jiangxi-2025-import.json`
- `data/admissions/dxsbb-national-2025-info-schools-import.json`
- `data/admissions/dxsbb-national-2025-medical-teacher-finance-import.json`
- `data/admissions/dxsbb-national-2025-jiangxi-provincial-engineering-import.json`
- `data/admissions/dxsbb-jiangxi-2025-nanchang-hangkong-import.json`
- `data/admissions/dxsbb-national-2025-broader-score-bands-import.json`
- `data/admissions/dxsbb-jiangxi-2025-private-lowband-import.json`
- `data/admissions/dxsbb-chongqing-2025-local-mid-low-import.json`
- `data/admissions/dxsbb-hubei-2025-private-lowband-import.json`
- `data/admissions/dxsbb-jiangxi-2025-local-public-more-import.json`
- `data/admissions/dxsbb-national-2025-measurement-finance-teacher-import.json`
- `data/admissions/dxsbb-guangdong-2025-teacher-point-import.json`
- `data/admissions/dxsbb-sichuan-2025-southwest-science-import.json`
- `data/admissions/dxsbb-jiangsu-2025-strong-public-import.json`
- `data/admissions/dxsbb-sichuan-hunan-shaanxi-2025-regional-public-import.json`
- `data/admissions/dxsbb-shaanxi-2025-public-engineering-recovery-import.json`
- `data/admissions/dxsbb-zhejiang-2025-local-public-import.json`
- `data/admissions/dxsbb-national-2025-985-211-west-south-focus-import.json`
- `data/admissions/dxsbb-national-2025-985-211-east-central-focus-import.json`
- `data/admissions/dxsbb-national-2025-211-north-northeast-focus-import.json`
- `data/admissions/dxsbb-national-2025-low-mid-private-local-import.json`
- `data/admissions/dxsbb-national-2025-list458-recent-expansion-import.json`
- `data/admissions/dxsbb-national-2025-list458-recent-expansion-2-import.json`
- `data/admissions/dxsbb-national-2025-list458-recent-expansion-3-import.json`
- `data/admissions/dxsbb-national-2025-list458-recent-expansion-4-import.json`
- `data/admissions/dxsbb-national-2024-list458-crossyear-import.json`
- `data/admissions/dxsbb-national-2024-list458-crossyear-2-import.json`
- `data/admissions/dxsbb-national-2024-list458-crossyear-3-import.json`
- `data/admissions/dxsbb-national-2024-list458-crossyear-4-import.json`
- `data/admissions/dxsbb-national-2024-list458-crossyear-5-import.json`
- `data/admissions/dxsbb-national-2023-list458-crossyear-import.json`
- `data/admissions/dxsbb-national-2023-list458-crossyear-2-import.json`
- `data/admissions/dxsbb-national-2023-list458-crossyear-3-import.json`
- `data/admissions/dxsbb-national-2023-list458-crossyear-4-import.json`
- `data/admissions/dxsbb-national-2023-list458-crossyear-5-import.json`
- `data/admissions/dxsbb-national-2022-list458-crossyear-import.json`
- `data/admissions/dxsbb-national-2022-list458-crossyear-2-import.json`
- `data/admissions/dxsbb-national-2022-list458-crossyear-3-import.json`
- `data/admissions/dxsbb-national-2022-list458-crossyear-4-import.json`
- `data/admissions/dxsbb-national-2022-list458-crossyear-5-import.json`
- `data/admissions/dxsbb-undergraduate-filing-2025-index-import.json`
- `data/admissions/dxsbb-undergraduate-filing-2024-index-import.json`
- `data/admissions/dxsbb-vocational-filing-2024-index-import.json`
- `data/admissions/dxsbb-hainan-vocational-filing-2024-import.json`
- `data/admissions/dxsbb-vocational-filing-2025-beijing-import.json`
- `data/admissions/official-guangdong-vocational-2024-import.json`
- `data/admissions/official-guizhou-vocational-2024-import.json`
- `data/admissions/official-hubei-vocational-2025-import.json`
- `data/admissions/official-hubei-undergraduate-filing-2025-import.json`
- `data/admissions/official-xinjiang-undergraduate2-filing-2025-import.json`
- `data/admissions/official-xinjiang-single-vocational-2025-import.json`
- `data/admissions/gk100-jilin-vocational-2025-local-image-import.json`
- `data/admissions/gk100-xinjiang-rank-conversion-2026-import.json`
- `data/admissions/official-fujian-vocational-2024-import.json`
- `data/admissions/official-sichuan-vocational-2024-import.json`
- `data/admissions/official-sichuan-control-lines-2026-import.json`
- `data/admissions/official-shandong-regular1-2024-rank-import.json`
- `data/admissions/official-shandong-vocational-2024-regular2-import.json`
- `data/admissions/official-shandong-vocational-2024-regular3-import.json`
- `data/admissions/official-shandong-regular1-2025-rank-import.json`
- `data/admissions/official-shandong-vocational-2025-regular2-import.json`
- `data/admissions/official-shandong-vocational-2025-regular3-import.json`
- `data/admissions/official-shanghai-undergraduate-2025-import.json`
- `data/admissions/official-shanghai-vocational-2025-import.json`
- `data/admissions/official-tianjin-vocational-2024-import.json`
- `data/admissions/official-zhejiang-ordinary-second-2025-import.json`
- `data/admissions/official-xinjiang-vocational-2024-import.json`
- `data/admissions/official-xinjiang-control-lines-2026-import.json`
- `data/admissions/official-shandong-control-lines-2026-import.json`
- `data/admissions/official-shandong-special-rank-conversion-2026-import.json`
- `data/admissions/official-shandong-art-dual-rank-conversion-2026-import.json`
- `data/admissions/official-shandong-spring-rank-conversion-2026-import.json`
- `data/admissions/official-jilin-control-lines-2026-import.json`
- `data/admissions/official-chongqing-ordinary-2024-import.json`
- `data/admissions/official-chongqing-undergraduate-2025-import.json`
- `data/admissions/official-chongqing-undergraduate-advance-2025-import.json`
- `data/admissions/official-chongqing-undergraduate-advance-a-2025-import.json`
- `data/admissions/official-chongqing-vocational-advance-2025-import.json`
- `data/admissions/official-xizang-control-lines-2026-import.json`
- `data/admissions/official-xizang-control-lines-2025-import.json`
- `data/admissions/qinghai-vocational-2024-image-mirror-import.json`
- `data/admissions/ningxia-vocational-2024-image-mirror-import.json`
- `data/admissions/official-ningxia-vocational-2024-import.json`
- `data/admissions/official-yunnan-daily-admission-2024-import.json`
- `data/admissions/official-jilin-vocational-conscript-plan-2025-import.json`
- `data/admissions/official-jilin-undergraduate-conscript-plan-2025-import.json`
- `data/admissions/jiangxi-vocational-2024-image-mirror-import.json`
- `data/admissions/anhui-vocational-2024-image-mirror-import.json`
- `data/admissions/official-anhui-vocational-2024-direct-import.json`
- `data/admissions/official-gansu-vocational-2024-import.json`
- `data/admissions/gansu-vocational-2024-image-mirror-import.json`
- `data/admissions/official-neimenggu-vocational-application-2024-import.json`
- `data/admissions/official-shanxi-vocational-filing-2025-import.json`
- `data/admissions/official-hubei-rank-conversion-2026-import.json`
- `data/admissions/official-tianjin-rank-conversion-2026-import.json`
- `data/admissions/official-ningxia-rank-conversion-2026-import.json`
- `data/admissions/official-qinghai-rank-conversion-2025-import.json`
- `data/admissions/official-qinghai-rank-conversion-2026-import.json`
- `data/admissions/official-qinghai-vocational-m-final-collection-rank-2024-import.json`
- `data/admissions/official-neimenggu-rank-conversion-2026-import.json`
- `data/admissions/official-jilin-rank-conversion-2025-import.json`
- `data/admissions/official-jilin-rank-conversion-2026-import.json`
- `data/admissions/official-beijing-rank-conversion-2026-import.json`
- `data/admissions/official-shanghai-rank-conversion-2026-import.json`
- `data/admissions/official-hainan-rank-conversion-2026-import.json`
- `data/admissions/official-heilongjiang-rank-conversion-2026-import.json`
- `data/admissions/official-sichuan-rank-conversion-2026-import.json`
- `data/admissions/official-fujian-rank-conversion-2026-import.json`
- `data/admissions/official-shaanxi-control-lines-2026-import.json`
- `data/admissions/official-shaanxi-rank-conversion-2026-import.json`
- `data/admissions/official-guangxi-rank-conversion-2026-import.json`
- `data/admissions/official-liaoning-rank-conversion-2026-import.json`
- `data/admissions/official-hunan-rank-conversion-2026-import.json`
- `data/admissions/official-jiangsu-rank-conversion-2026-import.json`
- `data/admissions/official-guangdong-rank-conversion-2026-import.json`
- `data/admissions/official-yunnan-rank-conversion-2025-import.json`
- `data/admissions/official-yunnan-rank-conversion-2026-import.json`
- `data/admissions/official-hebei-rank-conversion-2026-import.json`
- `data/admissions/official-henan-rank-conversion-2026-import.json`
- `data/admissions/official-henan-rank-conversion-2025-import.json`
- `data/admissions/official-henan-rank-conversion-2024-import.json`
- `data/admissions/official-content-mirror-henan-undergraduate1-filing-2024-zizzs-import.json`
- `data/admissions/official-content-mirror-henan-undergraduate1-liberal-filing-2024-zizzs-import.json`
- `data/admissions/official-jilin-filing-2019-import.json`
- `data/admissions/official-jilin-rank-conversion-2021-import.json`
- `data/admissions/official-jilin-rank-conversion-2022-import.json`
- `data/admissions/official-content-mirror-eol-jilin-rank-conversion-2023-import.json`
- `data/admissions/official-jilin-rank-conversion-2024-import.json`
- `data/admissions/official-jilin-special-rank-conversion-2024-import.json`
- `data/admissions/official-jilin-special-rank-conversion-2025-import.json`
- `data/admissions/official-anhui-rank-conversion-2026-import.json`
- `data/admissions/official-zhejiang-rank-conversion-2026-import.json`
- `data/admissions/official-guizhou-rank-conversion-2024-import.json`
- `data/admissions/official-gansu-rank-conversion-2024-import.json`
- `data/admissions/official-shanxi-sports-undergraduate-filing-2025-import.json`
- `data/admissions/official-shanxi-art-undergraduate-filing-2025-import.json`
- `data/admissions/official-shandong-special-filing-2025-import.json`
- `data/admissions/dxsbb-national-2026-rank-conversion.json`
- `data/admissions/dxsbb-national-2025-rank-conversion.json`
- `data/admissions/sources/dxsbb-2025-batches.json`
- 覆盖：31 个省级口径、2010、2011、2012、2013、2014 与 2015-2026 年、734529 条去重后的结构化种子/边界/计划/资格记录、116309 条位次换算记录、10049 所院校/高职院校/批次边界口径。院校层包括 985/211/双一流、信息类、医学、财经/商科、师范、省属工科、交通/电力、水利/电力、计量/质量、能源/石油、农林、语言外语、传媒、公安政法、民办/独立学院、地方公办本科、高职专科、艺术本科批、体育本科批和特殊路径资格线等分层样本。
- 专业录取/专业投档分：当前 `major-admission` 与 `major-group-admission` 合计 417043 条，其中 v3.233 新增西安邮电大学 2021 年 31 省单校分专业录取边界 644 条并另保留 2022 年招生计划 712 条，v3.232 新增西安电子科技大学 2022-2025 年 31 省单校分专业录取边界 1892 条，v3.231 新增华北电力大学（保定）2025 年 31 省单校分专业录取边界 1166 条，v3.230 新增东北电力大学 2021-2025 年 31 省单校分专业录取边界 4131 条，v3.161 新增四川农业大学西藏单校官方查询系统 12 条普通类理工专业录取分数边界，v3.160 新增牡丹江医科大学和中北大学西藏单校图片表 16 条专业录取分数边界；吉林 2025 高考100省内本科图片表保留 445 条第三方局部 score+rank 院校专业组种子，重庆 2025 本科提前批 B 段保留 1734 条官方 score-only 专业投档边界，江苏 2024 本科批次保留 3975 条官方 score-only 院校专业组投档边界，湖南 2024 本科批保留 5058 条官方 score-only 院校专业组投档边界，湖北 2025 本科普通批保留 4540 条 score-only 院校专业组投档边界，广东 2025 本科普通类保留 5137 条带最低排位的院校专业组投档边界，山东 2025 艺术类本科批/体育类常规批特殊类别综合分投档边界参与同类别匹配，山西 2025 艺术本科批保留 1417 条艺术类综合分院校专业组投档边界、山西 2025 体育本科批保留 137 条体育类综合分院校专业组投档边界，山东 2024/2025 普通类第1/2次志愿仍为 rank-only 专业投档/剩余计划边界；热点专业双年对照 13153 个，覆盖计算机科学与技术、软件工程、数据科学与大数据技术、人工智能、数字媒体技术、电子信息、电气、自动化、会计、护理等常见方向。
- 跨年趋势：当前有 66824 个同省同科类同校同专业双年可比专业，其中 38805 个带双年位次、13153 个为热点专业双年对照；另有 17935 个三年可比专业，其中 11642 个带三年位次、3453 个为热点专业三年对照；并形成 6074 个四年及以上可比专业，其中 5231 个带四年位次、1171 个为热点专业四年对照。趋势只做风险提示和证据加厚，不能替代当年官方招生计划。
- 分省成熟度：31 个省级口径全部生成成熟度评分，当前强证据省份 30 个、可用省份 1 个、种子省份 0 个；可计算一分一段省份 30 个，专科可用省份 30 个，三年趋势省份 31 个，四年趋势省份 30 个。成熟度会进入推荐风险提示，种子/待加厚省份不输出录取概率；吉林全库 48885 条，运行层含 1968 条 `institution-admission`、1505 条 `vocational-admission`、15452 条官方位次换算，v3.154 新增的 2019 official/chsi 第一次投档 PDF 让吉林 `missing` 清零并升为强证据，但年份和旧文理口径会在推荐解释中保留风险提示；西藏全库 24692 条、`control-line` 196 条，持续新增北京师范大学、闽南师范大学、中央民族大学、深圳大学、福建理工大学、西北工业大学、东北石油大学、辽宁大学、西安理工大学、沈阳建筑大学、河南农业大学、西藏民族大学、黑河学院、暨南大学、西交利物浦大学、牡丹江医科大学、中北大学、四川农业大学、长春理工大学、东北电力大学、华北电力大学（保定）、西安电子科技大学和西安邮电大学单校官方西藏录取分/计划后，运行层含 237 条院校录取/投档边界、693 条专业录取/专业组边界；其中 `school-official-only` 638 条、`special-path-only` 290 条，当前仍缺可计算一分一段、专业最低位次和高职专科投档数据，是严格 native `minScore` 省级正式投档/录取表的唯一剩余缺口。新疆、内蒙古、上海、天津、湖北、福建、四川、黑龙江、青海、重庆、江西、安徽、甘肃等省份的补数边界继续按各自 score-only、score+rank、rank-only、预计口径、官方内容镜像、学校官网单校分数和特殊路径标签分层使用；无最低位次的表不生成假位次，计划层、控制线、`school-official-only` 和 `special-path-only` 不生成普通正式分数闭合。
- v3.128 安徽直连更新：上方“安徽仍需原始页面直连闭合”的历史状态已被 `official-anhui-vocational-2024-direct-import.json` 覆盖；当前安徽 2024 普通高职（专科）批 1880 条运行记录均锚定到安徽省教育招生考试院官方页面和 10 张官方图片表，但结构化字段仍保留 OCR 复核边界。
- 本科投档线：新增省级本科投档记录，当前可计算广东、湖北、新疆、河北、江苏、湖南、辽宁、广西、甘肃、重庆、吉林；吉林 2019 official/chsi 第一次投档 PDF 接入 1814 条本科/专项院校层 score-only 投档边界，其中国家专项计划批和地方专项计划批 99 条按 `special-path-only` 隔离，普通一批 A/B、二批 A/B 只作旧文理口径进档边界，不含最低位次；吉林 2025 高考100省内本科图片表作为第三方局部种子接入 445 条 score+rank 院校专业组边界，其中物理类 294 条、历史类 151 条，分数 321-653、最低位次 335-72452，只覆盖吉林省内院校，不计作官方全量表；重庆 2025 本科批和本科提前批 B 段已接入 18857 条 score-only 专业行投档边界，其中提前批 B 段 1734 条，分数 491-688，原表无最低位次；新疆 2025 普通类本科二批官方图片表已接入历史/物理 737 条 score-only 院校投档线，分数 280-483，原表无最低位次；湖北 2025 本科普通批官方 PDF 已接入历史/物理 4540 条 score-only 院校专业组投档线，分数 380-682，原表无最低位次；广东 2025 本科普通类官方 PDF 已接入历史/物理 5137 条 score+rank 院校专业组投档线，分数 424-689、最低排位 13-292581；上海 2025 本科普通批次专业组官方投档线已接入 1379 条，其中 1331 条含公开投档线、48 条为 580 分及以上非公开精确线边界；山东 2025 艺术类本科批/体育类常规批特殊类别综合分投档边界、山西 2025 艺术本科批 1417 条 official/chsi 转载艺术类综合分院校专业组投档边界和山西 2025 体育本科批 137 条 official/chsi 转载体育类综合分院校专业组投档边界均按特殊类别隔离。本科投档线只判断进档边界，不替代专业录取结果，特殊类别投档线不混入普通类。
- v3.228 河南本科补数：新增 2024 本科二批 1938 条 third-party-content-mirror score+rank 院校投档边界，文科 828 条（427-534 分、最低位次 19197-98536）、理科 1110 条（392-565 分、最低位次 55035-336443）。本轮已定位河南省教育考试院官方发布页、HAEEA 数据中心文科/理科查询入口和 EOL 官方链接镜像，但命令行访问仍返回验证页；运行层使用 6617.com 转载图片表 OCR，保留 source image、OCR raw text、图片 SHA 与审计信息，不标记为考试院直连 official 或 `official-content-mirror`。1 张文科源图存在左侧院校列 OCR 缺失导致的未入库行，源图空投档行只作审计不造分数。连同 v3.226/v3.227 的 2024 本科一批文理 1076 条，河南 2024 本科一批和本科二批均已有可用候选边界；但河南 2025 新高考本科批、高职高专全量表、考试院直连二批附件和最终专业录取分仍需继续加厚。
- 高职专科：当前 `vocational-admission` 为 201398 条，覆盖浙江、山东、北京、江苏、湖南、河北、辽宁、陕西、山西、广西、广东、贵州、海南、新疆、青海、宁夏、内蒙古、重庆、江西、上海、湖北、福建、四川、黑龙江、安徽、天津、甘肃、吉林等普通高职专科投档/录取线/专业投档种子；贵州 2025 普通类高职（专科）批首轮至第4次征集志愿官方 PDF 运行层保留 12391 条 score+rank 投档边界，其中首轮 10453 条、征集轮次 1938 条，低于 250 分 673 条、低于 300 分 2097 条；云南 2025 高职（专科）补录征集志愿官方 XLSX 另保留 1902 条 `admission-plan` 补录计划层、计划数 14500 名，其中普通历史/物理 1791 条、艺体 111 条，只作低分段补录机会、专业池和计划约束，不计作 `vocational-admission` 或投档线；重庆 2025 高职专科批官网直连包保留 9094 条专业行 score-only 投档边界，覆盖历史/物理平行志愿、第1/2次征集，低于 200 分 1652 条、低于 250 分 1780 条、低于 300 分 2378 条；重庆 2025 高职专科提前批另有 68 条院校/性别/首选科目 score-only 投档边界，分数 202-511，全部按 `formalScoreScope=special-path-only` 隔离，只用于定向培养军士等提前批资格路径复核；山西 2025 普通专科（高职）批新增官方 PDF 院校专业组投档最低分 2091 条，历史类 951 条、物理类 1140 条，101-480 分，低于 250 分 408 条、低于 300 分 682 条，51 个未投档空分组只作审计，原表无最低位次不生成假位次；广西 2024 高职高专普通批新增 1816 条 `official-content-mirror` score-only 院校专业组投档边界，历史类 863 条、物理类 953 条，200-515 分，低于 250 分 371 条、低于 300 分 742 条，25 条空白投档分只作审计，旧 1567 条第三方学校级专科线按粒度差异保留；辽宁 2024 普通类高职（专科）批保留 5279 条 official score-only 专业投档最低分，历史类 2062 条、物理类 3217 条，150-523 分，300 分及以下 1345 条，旧第三方同键记录被替换后仅剩 13 条补充键；江苏 2024 专科批次保留 1300 条 official score-only 院校专业组投档边界，其中 250 分以下 175 条、300 分及以下 244 条；湖南 2024 高职专科批普通类第一次投档保留 1606 条 official score-only 院校专业组投档边界，其中 300 分及以下 219 条；北京 2025 专科（高职）普通批官方 PDF 保留运行层 580 条 official score-only 专业投档边界，低于 250 分 505 条、低于 300 分 580 条，另保留 6 条第三方未匹配补充键；黑龙江 2025 普通类高职（专科）批官方内容镜像 XLSX 保留 1206 条 score-only 院校专业组投档边界，其中低于 250 分 216 条、低于 300 分 407 条；新疆 2025 单列类高职（专科）批保留 680 条 score-only 院校投档线，其中低于 250 分 513 条、低于 300 分 662 条，单列类只服务对应报考类型；广东 2025 专科普通类官方 PDF 保留 2338 条 score+rank 院校专业组投档线，其中低于 250 分 95 条、低于 300 分 175 条；河北 2025 专科批官方 XLSX 保留 20615 条 score-only 专业投档最低分，其中低于 250 分 2545 条、低于 300 分 4381 条；吉林 2019 official/chsi 专科批第一次投档 PDF 保留 945 条 score-only 院校投档边界，其中可用分数 915 条、低于 200 分 73 条、低于 250 分 195 条、低于 300 分 412 条，分数 151-456，旧文理口径且原表无最低位次；吉林 2025 高考100省内专科图片表作为第三方局部种子保留 90 条 score+rank 院校专业组边界，物理/历史各 45 条，分数 162-447、最低位次 27837-79004。山东 2025 艺术类专科批特殊类别综合分投档记录进入同类别专科边界，山东 2024 第2/3次志愿保留 10858 条去重后的 rank-only 剩余计划/低分段边界，山东 2025 第3次志愿保留 759 条去重边界。另有吉林 2026 招生指南普通类计划层 20472 条 `admission-plan`、计划数 111262 名，吉林 2026 招生计划调整第2号 2 条 plan-only 记录，吉林 2026 定向培养军士/军队院校特殊资格线 82 条 `control-line`，吉林 2025 招生指南普通类计划层 19609 条 `admission-plan`、计划数 117252 名，吉林 2025 官方专科批第一轮、第二轮征集志愿普通类 PDF 2192 条 `admission-plan`、计划数 17039 名，吉林 2025 官方普通本科批征集志愿普通类 PDF 283 条 `admission-plan`、计划数 1843 名。这些计划层记录只作专业池、计划数、选科、学费、备注、低分段补录机会和特殊路径资格提示，不计作普通批次投档/录取线；山东普通类第1/2/3次志愿只含最低位次，不生成假最低分。北京、广东、贵州、宁夏、山东、浙江、福建、四川、黑龙江、湖北、上海、天津、新疆、内蒙古、青海、重庆、甘肃、江西、安徽、海南、湖南、江苏、辽宁、广西、吉林等来源继续按各自 score-only/score+rank/rank-only/预计/特殊类别/官方内容镜像口径分层使用；西藏仍是严格 native `minScore` 正式 official/chsi 投档/录取表唯一剩余缺口，吉林仍需近年新高考口径、最低位次和专业录取分继续加厚，不生成假分数、假位次或录取概率。
- 安徽专科 official-direct 细节：安徽 2024 普通高职（专科）批 official-direct 包含历史类 876 条、物理类 1004 条，分数 200-488，最低名次 2303-313410，低于 250 分 295 条、低于 300 分 633 条；source note 保存官方页面/图片 URL、本地路径、sha256、尺寸和字节数，旧镜像文件只保留为 OCR 结构来源和交叉核验。
- 位次换算：当前 116309 条一分一段/位次换算记录，年份为 2021-2026，当前可计算北京、天津、山东、山西、江西、浙江、安徽、河北、河南、湖北、湖南、江苏、重庆、吉林、辽宁、内蒙古、宁夏、青海、上海、海南、黑龙江、四川、福建、陕西、广西、广东、云南、贵州、甘肃、新疆；一分一段来源页/表已采集 170 个，其中 103 个可计算、67 个待解析。新疆 2026 高考100第三方图片镜像已补入 980 条文科/理科位次换算种子，文科映射历史类 451 条（174-624 分，累计 20509 人），理科映射物理类 529 条（165-693 分，累计 55211 人），只作同省同科类分数到位次估算，不计为新疆教育考试院原始官方附件闭合。吉林 2021 阳光高考页面标注来源为吉林省教育考试院，已补入旧文理口径 1143 条分数位次换算，理工类映射物理类 599 条、文史类映射历史类 544 条；吉林 2022 阳光高考页面标注来源为吉林省教育考试院，已补入旧文理口径 1092 条分数位次换算，理工类映射物理类 586 条、文史类映射历史类 506 条；吉林 2023 EOL 公开页标注来源为吉林省教育考试院，已补入旧文理口径 1172 条分数位次换算，理工类映射物理类 620 条、文史类映射历史类 552 条，按 `official-content-mirror` 使用但不等同于省考试院原站直连；吉林 2024 阳光高考页面标注来源为吉林省教育考试院，已补入普通类物理/历史 1155 条分数位次换算，并从同页补入艺术/体育 1361 条特殊类别位次换算，特殊类别按 `rankUsage=art/sports` 和 `rankCategory=艺术类/体育类` 隔离；吉林 2025 官方艺术类/体育类综合成绩 XLS/ZIP 已补入 2870 条特殊类别综合分位次换算，按 `rankUsage=art/sports` 与 11 个艺术方向/体育类 `rankCategory` 隔离，不与普通类文化成绩混用；云南 2025 官方 PNG 已补入历史类/物理类普通高考分数段位次换算，和云南 2026 官方 PNG 一样只作同年同科类分数到位次估算，不替代投档线或录取最低分。青海 2025/2026 普通类官方 PDF 与青海 2024 普通专科批次 M 段最后一次征集志愿排序成绩 PDF 已进入同省同科类位次换算层，后者按 `rankUsage=普通专科批次M段最后一次征集志愿排序成绩` 隔离。当前不会把低质量 OCR 当作可靠位次数据，甘肃、湖南、吉林 2023 HTML 表直接抽取分数/档分和累计人数并做连续性校验，贵州、安徽、浙江、辽宁、广东、吉林官方 PDF/XLS 文本层直接抽取并做同分/累计连续性校验，湖北、四川、福建、江苏、云南、河北、河南等图片/PDF 表只在 OCR 后累计人数连续性通过才入库；河南 2024 文科/理科、2025/2026 物理/历史官方 PDF 均只导入普通类口径；山东 2025/2026 文化成绩官方 XLS 均只导入“全体”综合口径，选考科目列只作审计，山东 2026 春季高考、艺体官方 XLS 分别导入春季高考专业类别、体育类综合成绩、本科艺术统考综合成绩、双达线专业成绩和双达线文化成绩口径，按 `rankUsage`/`rankCategory` 隔离。
- 新增学校：江西中医药大学、赣南医科大学、成都大学、长沙理工大学、浙江财经大学、安徽大学、安徽理工大学、沈阳化工大学、重庆理工大学、南昌大学共青学院、江西服装学院、重庆科技大学、重庆人文科技学院、武昌理工学院、武昌工学院、赣南师范大学、江西水利电力大学、中国计量大学、山东财经大学、福建师范大学、天津财经大学、重庆师范大学、广东技术师范大学、西南科技大学、南京邮电大学、河海大学、南京林业大学、南京农业大学、成都理工大学、四川农业大学、湖南科技学院、西安石油大学、陕西科技大学、嘉兴大学、丽水学院、浙江工商大学、电子科技大学、华南理工大学、中山大学、武汉大学、福州大学、中国科学技术大学、宁波大学、东华大学、新疆大学、陕西师范大学、西安交通大学、西安电子科技大学、成都中医药大学、重庆大学、海南大学、广西大学、暨南大学、中南大学、中国石油大学（华东）、厦门大学、合肥工业大学、苏州大学、南京大学、上海外国语大学、东北林业大学、东北农业大学、哈尔滨工程大学、延边大学、大连海事大学、大连理工大学、河北工业大学、中国地质大学（北京）、中国石油大学（北京）、中国矿业大学（北京）、华北电力大学、中央民族大学、中国人民公安大学、中国传媒大学、北京外国语大学、北京中医药大学、北京林业大学、北京化工大学、北京科技大学、重庆工商大学派斯学院、广州理工学院、德州学院、绵阳师范学院、西南交通大学。
- 用途：让网站能对任意省份先做全国候选、同省同科类强匹配、冲稳保和理由解释；有专业位次的记录优先进入强证据层。
- 边界：这不是全量官方库；没有位次的记录只做分数候选核验，不能输出录取概率。高职专科已经有独立数据类型和推荐路径，但仍必须按专业群、区域产业、专升本通道和就业质量单独评价，不能套本科排名逻辑。

导入大学生必备网全国学校录取分索引：

```bash
node scripts/import-dxsbb-school-index.mjs --year 2025 --out-prefix data/admissions/dxsbb-national-2025-list458-refresh
ADMISSIONS_ONLY=1 node scripts/build.mjs
```

导入同一批页面里的 2024 跨年专业分：

```bash
node scripts/import-dxsbb-school-index.mjs --year 2024 --link-year 2025 --all --out-prefix data/admissions/dxsbb-national-2024-list458-crossyear
ADMISSIONS_ONLY=1 node scripts/build.mjs
```

导入同一批页面里的 2023 跨年专业分：

```bash
node scripts/import-dxsbb-school-index.mjs --year 2023 --link-year 2025 --all --out-prefix data/admissions/dxsbb-national-2023-list458-crossyear
ADMISSIONS_ONLY=1 node scripts/build.mjs
```

导入同一批页面里的 2022 跨年专业分：

```bash
node scripts/import-dxsbb-school-index.mjs --year 2022 --link-year 2025 --all --out-prefix data/admissions/dxsbb-national-2022-list458-crossyear
ADMISSIONS_ONLY=1 node scripts/build.mjs
```

导入手工维护的第三方公开页来源清单：

```bash
node scripts/import-admission-sources.mjs
ADMISSIONS_ONLY=1 node scripts/build.mjs
```

一分一段导入命令：

```bash
node scripts/import-dxsbb-rank-conversion.mjs --year 2026 --out data/admissions/dxsbb-national-2026-rank-conversion.json --index-url https://www.dxsbb.com/news/list_223.html
node scripts/import-dxsbb-rank-conversion.mjs --year 2025 --out data/admissions/dxsbb-national-2025-rank-conversion.json --index-url https://www.dxsbb.com/news/list_223.html
node scripts/import-official-hubei-rank-conversion.mjs --out data/admissions/official-hubei-rank-conversion-2026-import.json
node scripts/import-official-guizhou-rank-conversion.mjs --out data/admissions/official-guizhou-rank-conversion-2024-import.json
node scripts/import-official-guizhou-rank-conversion.mjs --year 2025 --out data/admissions/official-guizhou-rank-conversion-2025-import.json
node scripts/import-official-guizhou-rank-conversion.mjs --year 2026 --out data/admissions/official-guizhou-rank-conversion-2026-import.json
node scripts/import-official-gansu-rank-conversion.mjs --out data/admissions/official-gansu-rank-conversion-2024-import.json
node scripts/import-official-tianjin-rank-conversion.mjs --out data/admissions/official-tianjin-rank-conversion-2026-import.json
node scripts/import-official-ningxia-rank-conversion.mjs --out data/admissions/official-ningxia-rank-conversion-2026-import.json
node scripts/import-official-qinghai-rank-conversion.mjs --year 2025 --page-url https://gaokao.chsi.com.cn/gkxx/zc/ss/202506/20250625/2293390854.html --pdf-url https://t2.chei.com.cn/news/getfile/2293390855-2293390854-f121c86b44b4af8cf100e87f15335615.pdf --out data/admissions/official-qinghai-rank-conversion-2025-import.json
node scripts/import-official-qinghai-rank-conversion.mjs --out data/admissions/official-qinghai-rank-conversion-2026-import.json
node scripts/import-official-qinghai-rank-conversion.mjs --scope vocational-m-final-collection --year 2024 --page-url 'https://gaokao.chsi.com.cn/news/file.do?attach=true&hist=false&id=2293305127&method=downFile' --pdf-url 'https://gaokao.chsi.com.cn/news/file.do?attach=true&hist=false&id=2293305127&method=downFile' --out data/admissions/official-qinghai-vocational-m-final-collection-rank-2024-import.json
node scripts/import-official-neimenggu-rank-conversion.mjs --out data/admissions/official-neimenggu-rank-conversion-2026-import.json
node scripts/import-official-jilin-rank-conversion.mjs --year 2026 --out data/admissions/official-jilin-rank-conversion-2026-import.json
node scripts/import-official-jilin-rank-conversion.mjs --year 2025 --out data/admissions/official-jilin-rank-conversion-2025-import.json
node scripts/import-official-beijing-rank-conversion.mjs --out data/admissions/official-beijing-rank-conversion-2026-import.json
node scripts/import-official-shanghai-rank-conversion.mjs --out data/admissions/official-shanghai-rank-conversion-2026-import.json
node scripts/import-official-hainan-rank-conversion.mjs --out data/admissions/official-hainan-rank-conversion-2026-import.json
node scripts/import-official-heilongjiang-rank-conversion.mjs --out data/admissions/official-heilongjiang-rank-conversion-2026-import.json
node scripts/import-official-sichuan-rank-conversion.mjs --out data/admissions/official-sichuan-rank-conversion-2026-import.json
node scripts/import-official-fujian-rank-conversion.mjs --out data/admissions/official-fujian-rank-conversion-2026-import.json
node scripts/import-official-shaanxi-control-lines-2026.mjs --out data/admissions/official-shaanxi-control-lines-2026-import.json
node scripts/import-official-shaanxi-rank-conversion.mjs --out data/admissions/official-shaanxi-rank-conversion-2026-import.json
node scripts/import-official-guangxi-rank-conversion.mjs --out data/admissions/official-guangxi-rank-conversion-2026-import.json
node scripts/import-official-liaoning-rank-conversion.mjs --out data/admissions/official-liaoning-rank-conversion-2026-import.json
node scripts/import-official-hunan-rank-conversion.mjs --out data/admissions/official-hunan-rank-conversion-2026-import.json
node scripts/import-official-jiangsu-rank-conversion.mjs --out data/admissions/official-jiangsu-rank-conversion-2026-import.json
node scripts/import-official-guangdong-rank-conversion.mjs --out data/admissions/official-guangdong-rank-conversion-2026-import.json
node scripts/import-official-yunnan-rank-conversion.mjs --year 2025 --out data/admissions/official-yunnan-rank-conversion-2025-import.json
node scripts/import-official-yunnan-rank-conversion.mjs --year 2026 --out data/admissions/official-yunnan-rank-conversion-2026-import.json
node scripts/import-official-hebei-rank-conversion.mjs --out data/admissions/official-hebei-rank-conversion-2026-import.json
node scripts/import-official-henan-rank-conversion.mjs --out data/admissions/official-henan-rank-conversion-2026-import.json
node scripts/import-official-henan-rank-conversion.mjs --year 2025 --out data/admissions/official-henan-rank-conversion-2025-import.json
node scripts/import-official-henan-rank-conversion.mjs --year 2024 --out data/admissions/official-henan-rank-conversion-2024-import.json
node scripts/import-official-jilin-filing-2019.mjs --out data/admissions/official-jilin-filing-2019-import.json
node scripts/import-official-jilin-rank-conversion-2021.mjs --out data/admissions/official-jilin-rank-conversion-2021-import.json
node scripts/import-official-jilin-rank-conversion-2022.mjs --out data/admissions/official-jilin-rank-conversion-2022-import.json
node scripts/import-eol-jilin-rank-conversion-2023.mjs --out data/admissions/official-content-mirror-eol-jilin-rank-conversion-2023-import.json
node scripts/import-official-anhui-rank-conversion.mjs --out data/admissions/official-anhui-rank-conversion-2026-import.json
node scripts/import-official-zhejiang-rank-conversion.mjs --out data/admissions/official-zhejiang-rank-conversion-2026-import.json
node scripts/import-official-shandong-rank-conversion.mjs --year 2025 --out data/admissions/official-shandong-rank-conversion-2025-import.json
node scripts/import-official-shandong-rank-conversion.mjs --year 2026 --out data/admissions/official-shandong-rank-conversion-2026-import.json
node scripts/import-official-shandong-control-lines-2026.mjs --out data/admissions/official-shandong-control-lines-2026-import.json
node scripts/import-official-shandong-special-rank-conversion-2026.mjs --out data/admissions/official-shandong-special-rank-conversion-2026-import.json
node scripts/import-official-shandong-art-dual-rank-conversion-2026.mjs --out data/admissions/official-shandong-art-dual-rank-conversion-2026-import.json
node scripts/import-official-shandong-spring-rank-conversion-2026.mjs --out data/admissions/official-shandong-spring-rank-conversion-2026-import.json
node scripts/import-official-jilin-control-lines-2026.mjs --out data/admissions/official-jilin-control-lines-2026-import.json
node scripts/import-official-xizang-control-lines-2025.mjs --out data/admissions/official-xizang-control-lines-2025-import.json
ADMISSIONS_ONLY=1 node scripts/build.mjs
```

高职专科/省级投档线导入命令：

```bash
node scripts/import-dxsbb-filing-lines.mjs --year 2024 --out data/admissions/dxsbb-vocational-filing-2024-index-import.json --index-url https://www.dxsbb.com/news/list_1001.html
node scripts/import-dxsbb-filing-lines.mjs --out data/admissions/dxsbb-vocational-filing-2025-beijing-import.json --url https://www.dxsbb.com/news/149120.html
node scripts/import-official-xinjiang-vocational.mjs --out data/admissions/official-xinjiang-vocational-2024-import.json
node scripts/import-qinghai-vocational-image-mirror.mjs --out data/admissions/qinghai-vocational-2024-image-mirror-import.json
node scripts/import-ningxia-vocational-image-mirror.mjs --out data/admissions/ningxia-vocational-2024-image-mirror-import.json
node scripts/import-jiangxi-vocational-image-mirror.mjs --out data/admissions/jiangxi-vocational-2024-image-mirror-import.json
node scripts/import-official-anhui-vocational-2024-direct.mjs --out data/admissions/official-anhui-vocational-2024-direct-import.json
node scripts/import-official-shanghai-vocational.mjs --out data/admissions/official-shanghai-vocational-2025-import.json
node scripts/import-official-hubei-vocational.mjs --out data/admissions/official-hubei-vocational-2025-import.json
node scripts/import-official-fujian-vocational.mjs --out data/admissions/official-fujian-vocational-2024-import.json
node scripts/import-official-sichuan-vocational.mjs --out data/admissions/official-sichuan-vocational-2024-import.json
node scripts/import-official-sichuan-control-lines-2026.mjs --out data/admissions/official-sichuan-control-lines-2026-import.json
node scripts/import-official-neimenggu-vocational-application-stats.mjs --out data/admissions/official-neimenggu-vocational-application-2024-import.json
node scripts/import-official-chongqing-ordinary-2024.mjs --out data/admissions/official-chongqing-ordinary-2024-import.json
node scripts/import-official-chongqing-ordinary-2024.mjs --year 2025 --scope undergraduate --out data/admissions/official-chongqing-undergraduate-2025-import.json
node scripts/import-official-chongqing-ordinary-2024.mjs --year 2025 --scope undergraduate-advance --out data/admissions/official-chongqing-undergraduate-advance-2025-import.json
node scripts/import-official-chongqing-ordinary-2024.mjs --year 2025 --scope undergraduate-advance-a --out data/admissions/official-chongqing-undergraduate-advance-a-2025-import.json
node scripts/import-official-chongqing-ordinary-2024.mjs --year 2025 --scope vocational-advance --out data/admissions/official-chongqing-vocational-advance-2025-import.json
node scripts/import-official-guangxi-vocational-2024.mjs --out data/admissions/official-guangxi-vocational-2024-import.json
node scripts/import-official-shanxi-vocational-filing-2025.mjs --out data/admissions/official-shanxi-vocational-filing-2025-import.json
node scripts/import-official-jilin-vocational-conscript-plan-2025.mjs --out data/admissions/official-jilin-vocational-conscript-plan-2025-import.json
node scripts/import-official-jilin-undergraduate-conscript-plan-2025.mjs --out data/admissions/official-jilin-undergraduate-conscript-plan-2025-import.json
node scripts/import-gk100-jilin-vocational-2025.mjs --out data/admissions/gk100-jilin-vocational-2025-local-image-import.json
ADMISSIONS_ONLY=1 node scripts/build.mjs
```

本科省级投档线导入命令：

```bash
node scripts/import-dxsbb-filing-lines.mjs --kind undergraduate --year 2025 --out data/admissions/dxsbb-undergraduate-filing-2025-index-import.json --index-url https://www.dxsbb.com/news/list_1001.html
node scripts/import-dxsbb-filing-lines.mjs --kind undergraduate --year 2024 --out data/admissions/dxsbb-undergraduate-filing-2024-index-import.json --index-url https://www.dxsbb.com/news/list_1001.html
node scripts/import-official-content-mirror-henan-undergraduate1-filing-2024-zizzs.mjs --source batch1-science --out data/admissions/official-content-mirror-henan-undergraduate1-filing-2024-zizzs-import.json
node scripts/import-official-content-mirror-henan-undergraduate1-filing-2024-zizzs.mjs --source batch1-liberal --out data/admissions/official-content-mirror-henan-undergraduate1-liberal-filing-2024-zizzs-import.json
node scripts/import-official-national-school-plan-score-2021-2022-v3233-xupt.mjs --use-cache --out data/admissions/official-national-school-plan-score-2021-2022-v3233-xupt-import.json
node scripts/import-official-national-school-admission-2022-2025-v3232-xidian.mjs --use-cache --out data/admissions/official-national-school-admission-2022-2025-v3232-xidian-import.json
node scripts/import-official-national-school-admission-2025-v3231-ncepu-baoding.mjs --use-cache --out data/admissions/official-national-school-admission-2025-v3231-ncepu-baoding-import.json
node scripts/import-official-national-school-admission-2017-2025-v3229-cust.mjs --use-cache --out data/admissions/official-national-school-admission-2017-2025-v3229-cust-import.json
node scripts/import-official-shanxi-sports-undergraduate-filing-2025.mjs --out data/admissions/official-shanxi-sports-undergraduate-filing-2025-import.json
node scripts/import-official-shanxi-art-undergraduate-filing-2025.mjs --out data/admissions/official-shanxi-art-undergraduate-filing-2025-import.json
node scripts/import-official-shandong-special-filing-2025.mjs --out data/admissions/official-shandong-special-filing-2025-import.json
node scripts/import-official-chongqing-ordinary-2024.mjs --out data/admissions/official-chongqing-ordinary-2024-import.json
node scripts/import-official-chongqing-ordinary-2024.mjs --year 2025 --scope undergraduate --out data/admissions/official-chongqing-undergraduate-2025-import.json
node scripts/import-official-chongqing-ordinary-2024.mjs --year 2025 --scope undergraduate-advance --out data/admissions/official-chongqing-undergraduate-advance-2025-import.json
node scripts/import-official-chongqing-ordinary-2024.mjs --year 2025 --scope undergraduate-advance-a --out data/admissions/official-chongqing-undergraduate-advance-a-2025-import.json
node scripts/import-official-chongqing-ordinary-2024.mjs --year 2025 --scope vocational-advance --out data/admissions/official-chongqing-vocational-advance-2025-import.json
node scripts/import-official-shandong-regular1-2025.mjs --year 2024 --source-id official-shandong-regular1-2024 --out data/admissions/official-shandong-regular1-2024-rank-import.json
node scripts/import-official-shandong-regular1-2025.mjs --year 2025 --source-id official-shandong-regular1-2025 --out data/admissions/official-shandong-regular1-2025-rank-import.json
ADMISSIONS_ONLY=1 node scripts/build.mjs
```

上海本科普通批次官方 PDF 导入命令：

```bash
node scripts/import-official-shanghai-undergraduate.mjs
ADMISSIONS_ONLY=1 node scripts/build.mjs
```

新增学校时先追加 `data/admissions/sources/dxsbb-2025-batches.json`，再重跑批量导入脚本。

大学生必备网 2025 全国学校录取分索引 `https://www.dxsbb.com/news/list_458.html` 已按 4 个批次导入完一遍，当前索引中 892 个 2025 学校页未导入数量为 0。`scripts/import-dxsbb-school-index.mjs` 会自动发现分页、跳过已入库 URL、按批次调用学校页导入器。导入器会从表格前文识别类似“2025四川省分专业录取情况”的省份和年份上下文，解决表格本身不含省份/年份列的问题。

导入器按表头识别 `最低分`、`投档分`、`分数线`、`最低分位次` 等字段，过滤艺术/体育等非普通志愿记录，并用省份白名单避免把表格小标题误作省份。

导入器还会做基础质量控制：

- `minScore > 750`、缺省份、缺学校、缺最低分的记录不进入最终验收。
- 若表格有最高分且 `maxScore < minScore`，该行丢弃。
- 普通本科仍过滤 `minScore < 250` 和艺术/艺考/体育等特殊口径；高职专科投档线由 `vocational-admission` 单独承载，最低分允许进入 100-750 区间。
- 学校会尽量补充城市和标签，如 `211`、`双一流`、`信息类特色`、`医学特色`、`民办/独立学院`。

mac_2T 运行镜像：

```bash
node scripts/mirror-runtime-to-mac2t.mjs
```

镜像目录：`/Volumes/mac_2T/gaokao_zhiyuan_site_runtime/`。本地服务会优先从镜像的 `site/data/knowledge.json` 读取 `/data/knowledge.json`，镜像不存在时回退到内部盘站点数据。

全国化规则：

- 省份是强维度，不允许把江西、广东、山东、河南等省的数据混用。
- 科类/选科是强维度，不允许把历史类、物理类、文科、理科、综合改革数据混用。
- 年份是强维度；跨年只能用位次趋势辅助，不可把上一年最低分直接当今年结论。
- 批次、院校专业组、专业代码、计划数和招生章程必须作为最终复核项。
- 任意省份都可以先输入画像和分数；该省未导入数据时，页面只输出全国候选和导入提示。

新增数据时优先级：

1. 江西省教育考试院当年本科投档情况统计表。
2. 院校本科招生网分专业录取分和最低位次。
3. 学校招生章程、专业组、计划数、选科要求。
4. 第三方汇总仅作种子或交叉核验，必须保留 `sourceQuality` 和复核提示。

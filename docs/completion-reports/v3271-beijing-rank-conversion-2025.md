# v3.271 完成报告：北京 2025 官方高考分数分布

完成时间：2026-07-13 03:27 CST

## Requirement Delta

| 验收项 | 最终状态 | 说明 |
|---|---|---|
| AC1 官方页面/PDF | met | 页面、PDF、重定向终点和缓存 SHA 均锁定在 `bjeea.cn` 官方证据。 |
| AC2 347 行累计闭合 | met | 318 条逐分、29 条官方合并段，累计人数闭合到 65434。 |
| AC3 全国/北京位次增量 | met | 全国 116656 条，北京分片 688 条，其中 2025 官方新增 347 条。 |
| AC4 第三方队列替代 | met | `dxsbb-rank-8df9f3efff` 已标记由官方源替代。 |
| AC5 运行与浏览器 | met | 31 省分片、mac_2T、HTTP、真实推荐提交与独立 Review 全部通过。 |

## Changed Behavior

- 北京 2025 综合类分数可以使用考试院官方累计位次区间；650 分对应 3102-3203 名。
- 官方合并段显示“同区间人数”，不再把 370-379 等区间误写成“同分人数”。
- 高分本科画像不再混入专科投档记录；低分专科画像仍保留 586 条北京专科记录。
- “不接受高学费中外合作”会保守排除学费未知的中外合作记录；已知低学费合作项目不被误伤。
- 347 条记录均带 `dataType=rank-conversion` 和官方 `sourceQuality`，未来全量重建不会丢失或降级。

## Defects Fixed

| 缺陷 | 根因 | 修复 | 验证 |
|---|---|---|---|
| 合并段上界显示为同分 | 以 `record.score !== 输入分数` 判断区间 | 只要 `scoreRange.min != max` 即按区间处理 | 370/379、698/700、100/109 回归 |
| 全量构建丢独立位次数组 | 构建器仅读 `records` | 新增 `splitAdmissionPayloadRecords` | 347 条完整进入 rank 构建路径 |
| 官方位次被少计 | 记录缺 `sourceQuality` | 导入、主库、分片同时保留类型和质量 | typed/official 均为 347 |
| 高分画像混入专科 | 用户画像入口未隔离学历路径 | 本科/专科双向过滤 | 650 分专科 0；200 分专科 586 |
| 学费未知合作项目穿透红线 | 空学费被当作 0 | 复合红线按未知风险处理 | 浏览器合作命中 0 |
| 主库单行化导致构建失败 | `jq -c` 把 1.82GB JSON 压成一行 | 从快照用 Node 多行流式修复并增加 347 条计数门 | 分片重建 31/31、unknown 0 |

## Verification and Evidence

| 表面 | 证据 | 结果 | 产物 |
|---|---|---|---|
| 信息 | 导入重放、哈希、累计与字段契约 | pass | `data/admissions/official-beijing-rank-conversion-2025-v3271-import.json` |
| 用户 | 合并段、学历路径、红线和北京真实推荐 | pass | `scripts/test-browser-runtime-shards-v3271.mjs` |
| 运维 | 内盘/外盘/HTTP 哈希与来源响应头 | pass | `data/admissions/official-beijing-rank-conversion-2025-v3271-runtime-manifest.json` |
| 审查 | 独立 Reviewer 前两次发现全部关闭，第三次结论 PASS | pass | `docs/change-manifests/v3271-beijing-rank-conversion-2025.yaml` |

最终主库、mac_2T 站点数据、mac_2T 顶层数据和 HTTP 完整响应 SHA-256 均为 `83a1add1e5b46d472827926031092a06167e76558ff0a62a3f0ef028e19f5c5c`；HTTP `content-length=1822287096`，来源头为 `mac_2T-mirror`。浏览器显示 v3.271、841776 条录取/计划记录、116656 条位次、5082 个来源，并用北京 650 分/3203 名成功生成高位段推荐，专科和冲突合作记录均为 0，控制台错误为 0。

## Reusable Lessons

- 1GB 以上主库必须保留多行流式格式；不得用 `jq -c` 生成供 `readline` 构建器读取的单行 JSON。
- 独立 `rankConversions` 数组必须在导入、全量构建、分片白名单和测试四处同时有契约。
- 学费缺失是未知风险，不是 0 元；遇到家庭复合红线时应保守排除并提示复核。

## Residual Risks

- 北京 2025 的 698 分以上及 379 分以下部分按官方合并分段发布，不能恢复为段内逐分位次。
- 一分一段只提供考生位置，不直接等于任何院校或专业的录取概率。
- 西藏仍缺普通类可计算一分一段、省级全量投档/录取表、专业最低位次和高职专科投档数据。

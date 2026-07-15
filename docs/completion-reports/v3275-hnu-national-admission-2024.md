# v3.275 湖南大学 2024 录取与 2025 计划全国官方数据完成报告

## 结论

湖南大学本科生招生信息网 `2025fs` 目录的 28 份分省 PDF 已在 APFS 工作区缓存、文本化、坐标审计并以 SHA-256 锁定。数据集新增 901 条湖南大学分专业记录：874 条含官网公开最低位次，27 条新疆记录仅有最低分并明确标记 `rankUnavailable=true`、`scoreOnly=true`。

主库升级为 `local-deterministic-v3.275-hnu2024-846432records`，结构化录取/计划记录共 846,432 条，浏览器运行时覆盖 31 个省级分片。901 条记录中，839 条为普通单校官方层 `school-official-only`，62 条为 `special-path-only`，不会混入普通自动推荐。

## 全国覆盖与边界

- 已覆盖北京、天津、河北、山西、内蒙古、辽宁、吉林、黑龙江、上海、江苏、浙江、安徽、福建、江西、山东、河南、湖北、湖南、广东、广西、海南、四川、贵州、云南、甘肃、青海、宁夏、新疆共 28 省级地区。
- 重庆、西藏、陕西在湖南大学官网本轮核验目录未见对应附件，未向用户显示成“有专业线”的省份。
- 每条最低分/最低位次的年度为 2024，计划数的年度为 2025，前端分片保留 `sourcePlanYear=2025`。
- 江西普通类的计算机科学与技术为 627 分、3880 位、计划 8；人工智能为 626 分、4052 位、计划 7。两条均来自院校官方层，而非省级最终投档表。

## 验证

```text
node --check scripts/import-official-national-school-admission-2024-v3275-hnu.mjs
node --check scripts/mirror-runtime-to-mac2t.mjs
node scripts/test-official-hnu-import-v3275.mjs
node scripts/test-browser-runtime-shards-v3274.mjs
node scripts/test-recommendation-boundaries-v3273.mjs
```

全部通过。镜像脚本已把本批导入器、审计测试、结构化导入数据和原始证据目录加入按需复制清单；在外置盘运行时仍须按既有 APFS 到 mac_2T 的安全同步流程执行。

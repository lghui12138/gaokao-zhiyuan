# v3.274 深圳大学 2024-2025 全国官方录取数据完成报告

## 结论

深圳大学本科招生网的 2 个官方索引页和 30 个省份页面已在 APFS 工作区完成缓存、SHA-256 审计与结构化导入。新增 1,568 条 2024-2025 年分省、分科类、分专业最低分记录；其中 1,509 条带官网公开最低位次，59 条未公开位次并保持 `rankUnavailable=true`。

主库升级为 `local-deterministic-v3.274-szu2024-2025-845531records`，结构化录取/计划记录共 845,531 条，覆盖 31 个省级运行分片。深圳大学数据覆盖 30 个省份；广东 42 条地方专项等限定路径独立标记为 `special-path-only`，不进入普通自动推荐。

## 西藏与计划边界

- 深圳大学西藏页面的 17 条记录保留 `A类考生` 或 `B类考生`；未选择类别时不进入普通自动推荐，选择后仅匹配相同类别。
- 浏览器分片保留该字段，防止主库到前端的字段丢失。
- 西藏的 2,187 条征集志愿记录与 6,099 个计划快照继续单列；年度计划总数维持 87,995，不将征集计划混入年度计划。
- 深圳大学页面属于院校官方单校层 `school-official-only`，不是省考试院的全量投档/录取表，因此不改变“西藏仍缺省级正式录取分数闭合”的事实边界。

## 验证

```text
node --check site/assets/app.js
node --check scripts/import-official-national-school-admission-2024-2025-v3274-szu.mjs
node --check scripts/mirror-runtime-to-mac2t.mjs
node scripts/test-official-szu-import-v3274.mjs
node scripts/test-szu-recommendation-boundaries-v3274.mjs
node scripts/test-browser-runtime-shards-v3274.mjs
node scripts/test-recommendation-boundaries-v3273.mjs
node scripts/test-recommendation-boundaries-v3272.mjs
```

全部通过。

## 镜像与 HTTP 回读

`/Volumes/mac_2T/gaokao_zhiyuan_site_runtime` 已原子同步。外置镜像直接读取结果为 v3.274、845,531 条记录、1,568 条深圳大学记录，西藏年度计划 87,995、征集记录 2,187、征集计划快照 6,099。

以下哈希在 APFS 源、外置镜像和 HTTP 读回三层一致：

- `knowledge-core.json`：`855cc156540276fc2a79546bbb715b3837e7a8ceb2fb57bd31182c032ad1a7e4`
- `provinces/xizang.json`：`eb8b1e2c5711aadf5ebca8972d5b0b2fadf506aed11e41a31fba7d15e6747312`
- `assets/app.js`：`d0b5f984245c0c18d533718d7d2e01d6c724ebbbb4b4326dd3b1b2f90e2272fa`

`http://127.0.0.1:4177/data/knowledge.json` 返回 `200`，并携带 `x-gaokao-data-source: mac_2T-mirror`。

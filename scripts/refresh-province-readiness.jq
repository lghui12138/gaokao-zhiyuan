def inc($key): .[$key] = ((.[$key] // 0) + 1);
def putset($field; $key): .[$field][$key] = true;
def keys_sorted($obj): ($obj // {} | keys | sort);
def count_keys($obj): (keys_sorted($obj) | length);
def years_sorted($obj): (keys_sorted($obj) | map(tonumber? // .) | sort | reverse);
def numeric_or_null($value):
  if ($value | type) == "number" then $value
  elif ($value | type) == "string" then ($value | tonumber? // null)
  else null
  end;
def status_label($status):
  if $status == "strong" then "强证据"
  elif $status == "usable" then "可用"
  elif $status == "seed" then "种子"
  else "待加厚"
  end;
def recommendation_use($status):
  if $status == "strong" then "可用于同省同科类强匹配排序，仍需回官方计划和章程复核。"
  elif $status == "usable" then "可做本省候选排序，但位次或专业分薄弱项需要人工核验。"
  elif $status == "seed" then "只能做本省种子候选和补数提示，不宜输出录取概率。"
  else "仅作全国候选参考，应优先补本省考试院和院校官方数据。"
  end;
def readiness_row($province; $stats; $rank; $old):
  ($stats[$province] // {}) as $s |
  ($rank[$province] // {}) as $rk |
  ($old[$province] // {}) as $o |
  ($s.majorRecords // 0) as $majorRecords |
  ($s.majorWithRank // 0) as $majorWithRank |
  ($s.institutionRecords // 0) as $institutionRecords |
  ($s.vocationalRecords // 0) as $vocationalRecords |
  ($s.planRecords // 0) as $planRecords |
  ($s.annualPlanCount // 0) as $annualPlanCount |
  ($s.vacancyPlanRecords // 0) as $vacancyPlanRecords |
  ($s.vacancyPlanSnapshotCount // 0) as $vacancyPlanSnapshotCount |
  ($s.ordinaryVocationalVacancyRecords // 0) as $ordinaryVocationalVacancyRecords |
  ($s.partialVocationalRecords // 0) as $partialVocationalRecords |
  ($s.officialRecords // 0) as $officialRecords |
  ($rk.officialRankRecords // 0) as $officialRankRecords |
  ($rk.rankConversionRecords // 0) as $rankConversionRecords |
  ($officialRecords + $officialRankRecords) as $officialEvidenceRecords |
  (($s.records // 0) - $planRecords) as $scoredRecords |
  (years_sorted($s.years)) as $years |
  ($o.trend2y // 0) as $trend2y |
  ($o.trend3y // 0) as $trend3y |
  ($o.trend4y // 0) as $trend4y |
  ([
    (if $majorRecords > 0 then 18 else 0 end),
    (if $majorWithRank >= 100 then 16 elif $majorWithRank > 0 then 10 else 0 end),
    (if $institutionRecords > 0 then 10 else 0 end),
    (if $vocationalRecords > 0 then 8 else 0 end),
    (if $rankConversionRecords > 0 then 16 else 0 end),
    (if $officialEvidenceRecords > 0 then 8 else 0 end),
    (if ($years | length) >= 4 then 14 elif ($years | length) >= 3 then 10 elif ($years | length) >= 2 then 6 else 0 end),
    (if $trend4y > 0 then 10 elif $trend3y > 0 then 8 elif $trend2y > 0 then 5 else 0 end),
    (if $scoredRecords >= 3000 then 8 elif $scoredRecords >= 1000 then 6 elif $scoredRecords >= 300 then 3 else 0 end)
  ] | add | if . > 100 then 100 else . end) as $score |
  (if $score >= 80 then "strong" elif $score >= 60 then "usable" elif $score >= 40 then "seed" else "thin" end) as $status |
  {
    province: $province,
    readinessScore: $score,
    status: $status,
    statusLabel: status_label($status),
    recommendationUse: recommendation_use($status),
    records: ($s.records // 0),
    schools: count_keys($s.schools),
    planRecords: $planRecords,
    planCount: $annualPlanCount,
    vacancyPlanRecords: $vacancyPlanRecords,
    vacancyPlanSnapshotCount: $vacancyPlanSnapshotCount,
    ordinaryVocationalVacancyRecords: $ordinaryVocationalVacancyRecords,
    years: $years,
    subjects: keys_sorted($s.subjects),
    dataTypes: ($s.dataTypes // {}),
    majorRecords: $majorRecords,
    majorWithRank: $majorWithRank,
    institutionRecords: $institutionRecords,
    vocationalRecords: $vocationalRecords,
    partialVocationalRecords: $partialVocationalRecords,
    officialRecords: $officialRecords,
    officialRankRecords: $officialRankRecords,
    officialEvidenceRecords: $officialEvidenceRecords,
    rankConversionRecords: $rankConversionRecords,
    rankParsedSource: ($o.rankParsedSource // false),
    rankQueuedSource: ($o.rankQueuedSource // false),
    trend2y: $trend2y,
    trend3y: $trend3y,
    trend4y: $trend4y,
    missing: ([
      (if $rankConversionRecords == 0 then (if ($o.rankQueuedSource // false) then "一分一段已采待解析" else "缺可计算一分一段" end) else empty end),
      (if $majorWithRank == 0 then "专业最低位次薄弱" else empty end),
      (if $vocationalRecords == 0 then (if $vacancyPlanRecords > 0 then "高职专科正式投档/录取数据待补（已有征集计划快照）" else "高职专科数据待补" end) elif $partialVocationalRecords == $vocationalRecords then "高职专科全量待补" else empty end),
      (if $officialEvidenceRecords == 0 then "省考试院官方附件待补" else empty end),
      (if ($years | length) < 3 then "历史年份不足三年" else empty end),
      (if $trend3y == 0 then "三年专业趋势待补" else empty end)
    ])
  };

(.admissionScoreLayer.provinceReadiness.rows | map({key: .province, value: .}) | from_entries) as $oldRows |
(reduce .admissionScoreLayer.records[] as $r ({};
  .[$r.province].records = ((.[$r.province].records // 0) + 1)
  | (if ($r.dataType // "") != "admission-plan" then .[$r.province].scoredRecords = ((.[$r.province].scoredRecords // 0) + 1) else . end)
  | .[$r.province].schools[$r.schoolName] = true
  | .[$r.province].years[($r.year | tostring)] = true
  | .[$r.province].subjects[$r.subjectType] = true
  | .[$r.province].dataTypes[$r.dataType // "unknown"] = ((.[$r.province].dataTypes[$r.dataType // "unknown"] // 0) + 1)
  | (if ($r.dataType // "") == "major-admission" then .[$r.province].majorRecords = ((.[$r.province].majorRecords // 0) + 1) else . end)
  | (if ($r.dataType // "") == "major-admission" and (($r.minRankEnd // null) != null) then .[$r.province].majorWithRank = ((.[$r.province].majorWithRank // 0) + 1) else . end)
  | (if ($r.dataType // "") == "institution-admission" then .[$r.province].institutionRecords = ((.[$r.province].institutionRecords // 0) + 1) else . end)
  | (if ($r.dataType // "") == "vocational-admission" then .[$r.province].vocationalRecords = ((.[$r.province].vocationalRecords // 0) + 1) else . end)
  | (if ($r.dataType // "") == "vocational-admission" and (($r.sourceQuality // "") | contains("partial")) then .[$r.province].partialVocationalRecords = ((.[$r.province].partialVocationalRecords // 0) + 1) else . end)
  | (if ($r.dataType // "") == "admission-plan" then
      .[$r.province].planRecords = ((.[$r.province].planRecords // 0) + 1)
      | (if ($r.planStage // "") == "征集志愿" or ($r.formalScoreScope // "") == "vacancy-plan-only" then
          .[$r.province].vacancyPlanRecords = ((.[$r.province].vacancyPlanRecords // 0) + 1)
          | .[$r.province].vacancyPlanSnapshotCount = ((.[$r.province].vacancyPlanSnapshotCount // 0) + (($r.planCount // 0) | tonumber? // 0))
          | (if (($r.formalScoreScope // "") == "vacancy-plan-only") and (($r.batch // "") | test("专科|高职")) then .[$r.province].ordinaryVocationalVacancyRecords = ((.[$r.province].ordinaryVocationalVacancyRecords // 0) + 1) else . end)
        else
          .[$r.province].annualPlanCount = ((.[$r.province].annualPlanCount // 0) + (($r.planCount // 0) | tonumber? // 0))
        end)
    else . end)
  | (if (($r.sourceQuality // "") | contains("official")) then .[$r.province].officialRecords = ((.[$r.province].officialRecords // 0) + 1) else . end)
  | (numeric_or_null($r.minScore // null)) as $score
  | (if $score != null then
      .[$r.province].scoreMin = (if (.[$r.province].scoreMin // null) == null or $score < .[$r.province].scoreMin then $score else .[$r.province].scoreMin end)
      | .[$r.province].scoreMax = (if (.[$r.province].scoreMax // null) == null or $score > .[$r.province].scoreMax then $score else .[$r.province].scoreMax end)
      | (if $score < 200 then .[$r.province].lowBands.below200 = ((.[$r.province].lowBands.below200 // 0) + 1) else . end)
      | (if $score < 250 then .[$r.province].lowBands.below250 = ((.[$r.province].lowBands.below250 // 0) + 1) else . end)
      | (if $score < 300 then .[$r.province].lowBands.below300 = ((.[$r.province].lowBands.below300 // 0) + 1) else . end)
      | (if $score < 500 then .[$r.province].lowBands.below500 = ((.[$r.province].lowBands.below500 // 0) + 1) else . end)
    else . end)
)) as $stats |
(reduce .admissionScoreLayer.rankConversions[] as $r ({};
  .[$r.province].rankConversionRecords = ((.[$r.province].rankConversionRecords // 0) + 1)
  | (if (($r.sourceQuality // "") | contains("official")) then .[$r.province].officialRankRecords = ((.[$r.province].officialRankRecords // 0) + 1) else . end)
)) as $rankStats |
(.admissionScoreLayer.provinceReadiness.rows | map(.province)) as $provinces |
($provinces | map(readiness_row(.; $stats; $rankStats; $oldRows)) | sort_by([- .readinessScore, - .records, .province])) as $rows |
($provinces | map(
  . as $province |
  ($stats[$province] // {}) as $s |
  {
    province: $province,
    records: ($s.records // 0),
    years: years_sorted($s.years),
    subjects: keys_sorted($s.subjects),
    dataTypes: ($s.dataTypes // {}),
    scoreRange: (if ($s.scoreMin // null) == null then null else {min: $s.scoreMin, max: $s.scoreMax} end),
    lowBands: {
      below200: ($s.lowBands.below200 // 0),
      below250: ($s.lowBands.below250 // 0),
      below300: ($s.lowBands.below300 // 0),
      below500: ($s.lowBands.below500 // 0)
    }
  }
) | sort_by(.province)) as $provinceBreakdown |
($rows | {
  provinces: length,
  strong: (map(select(.status == "strong")) | length),
  usable: (map(select(.status == "usable")) | length),
  seed: (map(select(.status == "seed")) | length),
  thin: (map(select(.status == "thin")) | length),
  rankReady: (map(select(.rankConversionRecords > 0)) | length),
  vocationalReady: (map(select(.vocationalRecords > 0)) | length),
  trend3yReady: (map(select(.trend3y > 0)) | length),
  trend4yReady: (map(select(.trend4y > 0)) | length),
  weakest: (sort_by([.readinessScore, .records]) | .[0:8]),
  rows: .
}) as $readiness |
.admissionScoreLayer.provinceReadiness = $readiness |
.admissionScoreLayer.coverage.provinceReadiness = $readiness |
.admissionScoreLayer.coverage.provinceBreakdown = $provinceBreakdown

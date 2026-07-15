def add_low_bands($score):
  if ($score | type) == "number" then
    .below200 = ((.below200 // 0) + (if $score < 200 then 1 else 0 end))
    | .below250 = ((.below250 // 0) + (if $score < 250 then 1 else 0 end))
    | .below300 = ((.below300 // 0) + (if $score < 300 then 1 else 0 end))
    | .below500 = ((.below500 // 0) + (if $score < 500 then 1 else 0 end))
  else
    .
  end;

def merge_score_range($score):
  if ($score | type) == "number" then
    (. // {min: $score, max: $score})
    | .min = ([.min, $score] | min)
    | .max = ([.max, $score] | max)
  else
    .
  end;

def ensure_year_item($year):
  if any(.year == $year) then
    .
  else
    . + [{year: $year, records: 0, dataTypes: {}, provinces: 0, schools: 0}]
  end;

def update_year_breakdown($records):
  reduce $records[] as $r (.;
    .yearBreakdown = ((.yearBreakdown // []) | ensure_year_item($r.year))
    | .yearBreakdown = (.yearBreakdown | map(
      if .year == $r.year then
        .records = ((.records // 0) + 1)
        | .dataTypes[$r.dataType] = ((.dataTypes[$r.dataType] // 0) + 1)
      else
        .
      end
    ))
  )
  | .yearBreakdown = (.yearBreakdown | sort_by(.year) | reverse);

def ensure_province_item($province):
  if any(.province == $province) then
    .
  else
    . + [{
      province: $province,
      records: 0,
      years: [],
      subjects: [],
      dataTypes: {},
      scoreRange: null,
      lowBands: {below200: 0, below250: 0, below300: 0, below500: 0}
    }]
  end;

def update_province_breakdown($records):
  reduce $records[] as $r (.;
    .provinceBreakdown = ((.provinceBreakdown // []) | ensure_province_item($r.province))
    | .provinceBreakdown = (.provinceBreakdown | map(
      if .province == $r.province then
        .records = ((.records // 0) + 1)
        | .years = (((.years // []) + [$r.year]) | unique | sort | reverse)
        | .subjects = (((.subjects // []) + [$r.subjectType]) | unique | sort)
        | .dataTypes[$r.dataType] = ((.dataTypes[$r.dataType] // 0) + 1)
        | .scoreRange = (.scoreRange | merge_score_range($r.minScore))
        | .lowBands = ((.lowBands // {below200: 0, below250: 0, below300: 0, below500: 0}) | add_low_bands($r.minScore))
      else
        .
      end
    ))
  )
  | .provinceBreakdown = (.provinceBreakdown | sort_by(.province));

($imp[0]) as $payload
| ($payload.records) as $newRecords
| ($payload.sourceNotes[0]) as $sourceNote
| ($newRecords | length) as $recordDelta
| ($sourceNote.rawFiles | length) as $fileDelta
| ([ $newRecords[] | select(.dataType == "admission-plan") | (.planCount // 0) ] | add // 0) as $planCountDelta
| if ((.admissionScoreLayer.sourceNotes | map(.id) | index($sourceNote.id)) != null) then
    error("duplicate sourceNote id: " + $sourceNote.id)
  elif ((.admissionScoreLayer.records | map(select(.sourceId == $sourceNote.id)) | length) > 0) then
    error("duplicate records for sourceId: " + $sourceNote.id)
  else
    .generatedAt = $payload.generatedAt
    | .sourceFiles = (((.sourceFiles // []) + [$importPath]) | unique | sort)
    | .admissionScoreLayer.records += $newRecords
    | .admissionScoreLayer.sourceNotes += [$sourceNote]
    | .admissionScoreLayer.structuredRecords = (.admissionScoreLayer.records | length)
    | .admissionScoreLayer.statusLabel = ("已接入" + (.admissionScoreLayer.structuredRecords | tostring) + "条结构化录取/计划数据 + " + (.admissionScoreLayer.rankConversionRecords | tostring) + "条一分一段记录")
    | .admissionScoreLayer.currentFinding = $finding
    | .admissionScoreLayer.admissionPlanRecords = ((.admissionScoreLayer.admissionPlanRecords // 0) + $payload.audit.planRecords)
    | .admissionScoreLayer.admissionPlanCount = ((.admissionScoreLayer.admissionPlanCount // 0) + $planCountDelta)
    | .admissionScoreLayer.availableEvidenceIds = (((.admissionScoreLayer.availableEvidenceIds // []) + [$sourceNote.id]) | unique | sort)
    | .admissionScoreLayer.downgradeReason = ("当前数据层 " + $versionId + " 仍对计划层、控制线、学校官网单校分数和 special-path-only 做风险隔离；省级正式投档/录取全量缺口仍为西藏。")
    | .admissionScoreLayer.coverage.records = .admissionScoreLayer.structuredRecords
    | .admissionScoreLayer.coverage.rawRecords = .admissionScoreLayer.structuredRecords
    | .admissionScoreLayer.coverage.files = ((.admissionScoreLayer.coverage.files // 0) + $fileDelta)
    | .admissionScoreLayer.coverage.rankConversionRecords = .admissionScoreLayer.rankConversionRecords
    | .admissionScoreLayer.coverage.lowBands = (reduce $newRecords[] as $r ((.admissionScoreLayer.coverage.lowBands // {below200: 0, below250: 0, below300: 0, below500: 0}); add_low_bands($r.minScore)))
    | .admissionScoreLayer.coverage.scoreRange = (reduce $newRecords[] as $r (.admissionScoreLayer.coverage.scoreRange; merge_score_range($r.minScore)))
    | .admissionScoreLayer.coverage.provinces = (((.admissionScoreLayer.coverage.provinces // []) + ($newRecords | map(.province))) | unique | sort)
    | .admissionScoreLayer.coverage.years = (((.admissionScoreLayer.coverage.years // []) + ($newRecords | map(.year))) | unique | sort | reverse)
    | .admissionScoreLayer.coverage |= update_year_breakdown($newRecords)
    | .admissionScoreLayer.coverage |= update_province_breakdown($newRecords)
  end

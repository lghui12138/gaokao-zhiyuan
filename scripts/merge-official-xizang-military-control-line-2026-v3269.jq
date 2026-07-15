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
        | .lowBands = (
            if $r.formalScoreScope == "special-path-only" then
              (.lowBands // {below200: 0, below250: 0, below300: 0, below500: 0})
            else
              ((.lowBands // {below200: 0, below250: 0, below300: 0, below500: 0}) | add_low_bands($r.minScore))
            end
          )
      else
        .
      end
    ))
  )
  | .provinceBreakdown = (.provinceBreakdown | sort_by(.province));

def merge_count_maps($left; $right):
  reduce (((($left // {}) | keys) + (($right // {}) | keys)) | unique[]) as $key ({};
    .[$key] = (($left[$key] // 0) + ($right[$key] // 0))
  );

def normalize_inner_mongolia_alias:
  .admissionScoreLayer.records |= map(if .province == "内蒙" then .province = "内蒙古" else . end)
  | .admissionScoreLayer.coverage.provinces |= (map(if . == "内蒙" then "内蒙古" else . end) | unique | sort)
  | (.admissionScoreLayer.coverage.provinceBreakdown // []) as $rows
  | ($rows | map(select(.province == "内蒙")) | .[0] // null) as $alias
  | if $alias == null then
      .
    else
      ($rows | map(select(.province == "内蒙古")) | .[0] // {
        province: "内蒙古",
        records: 0,
        years: [],
        subjects: [],
        dataTypes: {},
        scoreRange: null,
        lowBands: {below200: 0, below250: 0, below300: 0, below500: 0}
      }) as $canonical
      | ($canonical
        | .records = (($canonical.records // 0) + ($alias.records // 0))
        | .years = ((($canonical.years // []) + ($alias.years // [])) | unique | sort | reverse)
        | .subjects = ((($canonical.subjects // []) + ($alias.subjects // [])) | unique | sort)
        | .dataTypes = merge_count_maps($canonical.dataTypes; $alias.dataTypes)
        | .scoreRange = {
            min: ([$canonical.scoreRange.min, $alias.scoreRange.min] | map(select(type == "number")) | min),
            max: ([$canonical.scoreRange.max, $alias.scoreRange.max] | map(select(type == "number")) | max)
          }
        | .lowBands = {
            below200: (($canonical.lowBands.below200 // 0) + ($alias.lowBands.below200 // 0)),
            below250: (($canonical.lowBands.below250 // 0) + ($alias.lowBands.below250 // 0)),
            below300: (($canonical.lowBands.below300 // 0) + ($alias.lowBands.below300 // 0)),
            below500: (($canonical.lowBands.below500 // 0) + ($alias.lowBands.below500 // 0))
          }
      ) as $merged
      | .admissionScoreLayer.coverage.provinceBreakdown = ((
          $rows | map(select(.province != "内蒙" and .province != "内蒙古"))
        ) + [$merged] | sort_by(.province))
    end;

($imp[0]) as $payload
| ($payload.records) as $newRecords
| ($payload.sourceNotes[0]) as $sourceNote
| ($sourceNote.rawFiles | length) as $fileDelta
| if ((.admissionScoreLayer.sourceNotes | map(.id) | index($sourceNote.id)) != null) then
    error("duplicate sourceNote id: " + $sourceNote.id)
  elif ((.admissionScoreLayer.records | map(select(.sourceId == $sourceNote.id)) | length) > 0) then
    error("duplicate records for sourceId: " + $sourceNote.id)
  else
    .generatedAt = $payload.generatedAt
    | .modelVersion = $versionId
    | .modelPolicy.version = $versionId
    | .sourceFiles = (((.sourceFiles // []) + [$importPath]) | unique | sort)
    | .admissionScoreLayer.records += $newRecords
    | .admissionScoreLayer.sourceNotes += [$sourceNote]
    | .admissionScoreLayer.structuredRecords = (.admissionScoreLayer.records | length)
    | .admissionScoreLayer.statusLabel = ("已接入" + (.admissionScoreLayer.structuredRecords | tostring) + "条结构化录取/计划数据 + " + (.admissionScoreLayer.rankConversionRecords | tostring) + "条一分一段记录")
    | .admissionScoreLayer.currentFinding = $finding
    | .admissionScoreLayer.availableEvidenceIds = (((.admissionScoreLayer.availableEvidenceIds // []) + [$sourceNote.id]) | unique | sort)
    | .admissionScoreLayer.downgradeReason = ("当前数据层 " + $versionId + " 仍对计划层、控制线、学校官网单校分数和 special-path-only 做风险隔离；省级正式投档/录取全量缺口仍需继续按省补厚。")
    | .admissionScoreLayer.coverage.records = .admissionScoreLayer.structuredRecords
    | .admissionScoreLayer.coverage.rawRecords = .admissionScoreLayer.structuredRecords
    | .admissionScoreLayer.coverage.files = ((.admissionScoreLayer.coverage.files // 0) + $fileDelta)
    | .admissionScoreLayer.coverage.rankConversionRecords = .admissionScoreLayer.rankConversionRecords
    | .admissionScoreLayer.coverage.lowBands = (reduce $newRecords[] as $r ((.admissionScoreLayer.coverage.lowBands // {below200: 0, below250: 0, below300: 0, below500: 0}); if $r.formalScoreScope == "special-path-only" then . else add_low_bands($r.minScore) end))
    | .admissionScoreLayer.coverage.scoreRange = (reduce $newRecords[] as $r (.admissionScoreLayer.coverage.scoreRange; merge_score_range($r.minScore)))
    | .admissionScoreLayer.coverage.provinces = (((.admissionScoreLayer.coverage.provinces // []) + ($newRecords | map(.province))) | unique | sort)
    | .admissionScoreLayer.coverage.years = (((.admissionScoreLayer.coverage.years // []) + ($newRecords | map(.year))) | unique | sort | reverse)
    | .admissionScoreLayer.coverage |= update_year_breakdown($newRecords)
    | .admissionScoreLayer.coverage |= update_province_breakdown($newRecords)
  end
| normalize_inner_mongolia_alias

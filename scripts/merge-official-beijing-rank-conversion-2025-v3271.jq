def add_unique_sorted($values):
  ((. // []) + $values | unique | sort);

def update_beijing_readiness($delta):
  map(
    if .province == "北京" then
      .rankConversionRecords = ((.rankConversionRecords // 0) + $delta)
      | .officialRankRecords = ((.officialRankRecords // 0) + $delta)
      | .officialEvidenceRecords = ((.officialEvidenceRecords // 0) + $delta)
      | .rankParsedSource = true
      | .rankQueuedSource = true
    else
      .
    end
  );

($imp[0]) as $payload
| ($payload.sourceNotes[0]) as $sourceNote
| ($payload.rankConversions) as $newRanks
| ($newRanks | length) as $delta
| if (($payload.sourceNotes | length) != 1) then
    error("expected exactly one source note")
  elif ($delta != 347) then
    error("expected exactly 347 Beijing rank conversions")
  elif ((.admissionScoreLayer.sourceNotes | map(.id) | index($sourceNote.id)) != null) then
    error("duplicate source note: " + $sourceNote.id)
  elif ((.admissionScoreLayer.rankConversions | map(select(.province == "北京" and .year == 2025 and .subjectType == "综合")) | length) != 0) then
    error("Beijing 2025 ordinary rank conversions already exist")
  elif ((.admissionScoreLayer.sourceNotes | map(select(.id == $supersededId and (.parsedRecords // 0) == 0)) | length) != 1) then
    error("expected exactly one queued third-party Beijing 2025 source")
  elif (.admissionScoreLayer.rankConversionRecords != 116309)
    or (.admissionScoreLayer.rankSourceCoverage.sources != 203)
    or (.admissionScoreLayer.rankSourceCoverage.parsedSources != 136)
    or (.admissionScoreLayer.rankSourceCoverage.queuedSources != 67)
    or (.admissionScoreLayer.rankSourceCoverage.imageQueuedSources != 67) then
    error("v3.270 rank coverage frontier no longer matches expected counts")
  else
    .generatedAt = $payload.generatedAt
    | .modelVersion = $versionId
    | .modelPolicy.version = $versionId
    | .sourceFiles = (((.sourceFiles // []) + [$importPath]) | unique | sort)
    | .admissionScoreLayer.rankConversions += $newRanks
    | .admissionScoreLayer.rankConversionRecords = (.admissionScoreLayer.rankConversions | length)
    | .admissionScoreLayer.sourceNotes = (
        .admissionScoreLayer.sourceNotes
        | map(if .id == $supersededId then . + {
            supersededBy: $sourceNote.id,
            supersededReason: "北京教育考试院2025官方PDF已解析，第三方图片队列不再需要处理。"
          } else . end)
        | . + [$sourceNote]
      )
    | .admissionScoreLayer.statusLabel = ("已接入" + (.admissionScoreLayer.structuredRecords | tostring) + "条结构化录取/计划数据 + " + (.admissionScoreLayer.rankConversionRecords | tostring) + "条一分一段记录")
    | .admissionScoreLayer.currentFinding = $finding
    | .admissionScoreLayer.availableEvidenceIds = (((.admissionScoreLayer.availableEvidenceIds // []) + [$sourceNote.id]) | unique | sort)
    | .admissionScoreLayer.coverage.rankConversionRecords = .admissionScoreLayer.rankConversionRecords
    | .admissionScoreLayer.coverage.files = ((.admissionScoreLayer.coverage.files // 0) + ($sourceNote.rawFiles | length))
    | .admissionScoreLayer.rankCoverage.records = .admissionScoreLayer.rankConversionRecords
    | .admissionScoreLayer.rankCoverage.provinces |= add_unique_sorted(["北京"])
    | .admissionScoreLayer.rankCoverage.years |= add_unique_sorted([2025])
    | .admissionScoreLayer.rankSourceCoverage.parsedSources += 1
    | .admissionScoreLayer.rankSourceCoverage.queuedSources -= 1
    | .admissionScoreLayer.rankSourceCoverage.parsedRecords = .admissionScoreLayer.rankConversionRecords
    | .admissionScoreLayer.rankSourceCoverage.imageQueuedSources -= 1
    | .admissionScoreLayer.rankSourceCoverage.parsedProvinces |= add_unique_sorted(["北京"])
    | .admissionScoreLayer.rankSourceCoverage.sampleQueuedSources |= map(select(.url != "https://www.dxsbb.com/news/148791.html"))
    | .admissionScoreLayer.rankSourceCoverage.byYear |= map(
        if .year == 2025 then
          .parsedSources += 1
          | .queuedSources -= 1
          | .parsedRecords += $delta
          | .parsedProvinces |= add_unique_sorted(["北京"])
          | .queuedProvinces |= map(select(. != "北京"))
        else
          .
        end
      )
    | .admissionScoreLayer.provinceReadiness.rows |= update_beijing_readiness($delta)
    | .admissionScoreLayer.coverage.provinceReadiness.rows |= update_beijing_readiness($delta)
  end

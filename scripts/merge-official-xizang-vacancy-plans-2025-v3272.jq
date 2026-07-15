def add_unique_sorted($values):
  ((. // []) + $values | unique | sort);

def update_xizang_readiness($recordDelta; $snapshotDelta; $ordinaryVocationalDelta):
  map(
    if .province == "西藏" then
      .records = ((.records // 0) + $recordDelta)
      | .planRecords = ((.planRecords // 0) + $recordDelta)
      | .officialRecords = ((.officialRecords // 0) + $recordDelta)
      | .officialEvidenceRecords = ((.officialEvidenceRecords // 0) + $recordDelta)
      | .vacancyPlanRecords = ((.vacancyPlanRecords // 0) + $recordDelta)
      | .vacancyPlanSnapshotCount = ((.vacancyPlanSnapshotCount // 0) + $snapshotDelta)
      | .ordinaryVocationalVacancyRecords = ((.ordinaryVocationalVacancyRecords // 0) + $ordinaryVocationalDelta)
      | .dataTypes["admission-plan"] = ((.dataTypes["admission-plan"] // 0) + $recordDelta)
      | .recommendationUse = "可做本省候选排序；2025征集计划只用于识别历史补录机会，位次、正式投档/录取线和专业最低位次仍需人工核验。"
      | .missing |= map(
          if . == "高职专科数据待补" then
            "高职专科正式投档/录取数据待补（已有征集计划快照）"
          else
            .
          end
        )
    else
      .
    end
  );

($imp[0]) as $payload
| ($payload.records) as $newRecords
| ($payload.sourceNotes[0]) as $vacancySource
| ($payload.sourceNotes[1]) as $scheduleSource
| ($newRecords | length) as $recordDelta
| ($payload.audit.planSnapshotCount) as $snapshotDelta
| ($payload.audit.ordinaryVocationalRecordCount) as $ordinaryVocationalDelta
| INDEX($newRecords[]; .id) as $newIdIndex
| if (($payload.sourceNotes | length) != 2) then
    error("expected exactly two source notes")
  elif ($recordDelta != 2187)
    or ($payload.audit.ordinaryRecordCount != 2157)
    or ($payload.audit.specialPathRecordCount != 30)
    or ($payload.audit.ordinaryVocationalRecordCount != 926)
    or ($snapshotDelta != 6099)
    or ($payload.audit.vacancyPageCount != 12)
    or ($payload.audit.attachmentCount != 23)
    or ($payload.audit.expectedHashCoverage != 37)
    or ($payload.audit.minScoreFieldCount != 0)
    or ($payload.audit.minRankFieldCount != 0) then
    error("v3.272 import audit no longer matches the approved frontier")
  elif (($vacancySource.rawFiles | length) != 35)
    or (($scheduleSource.rawFiles | length) != 2)
    or (($scheduleSource.schedule | length) != 6) then
    error("v3.272 source-file or schedule evidence is incomplete")
  elif ((.admissionScoreLayer.sourceNotes | map(.id) | index($vacancySource.id)) != null)
    or ((.admissionScoreLayer.sourceNotes | map(.id) | index($scheduleSource.id)) != null) then
    error("v3.272 source note already exists")
  elif ((.admissionScoreLayer.records | map(select($newIdIndex[.id] != null)) | length) != 0) then
    error("v3.272 record IDs overlap the current master")
  elif (.admissionScoreLayer.structuredRecords != 841776)
    or (.admissionScoreLayer.admissionPlanRecords != 69690)
    or (.admissionScoreLayer.admissionPlanCount != 358294)
    or (.admissionScoreLayer.rankConversionRecords != 116656)
    or (.admissionScoreLayer.coverage.records != 841776)
    or (.admissionScoreLayer.coverage.dataTypes["admission-plan"] != 69690) then
    error("v3.271 baseline counts no longer match")
  elif (($newRecords | map(select(
      .dataType != "admission-plan"
      or .planOnly != true
      or .planStage != "征集志愿"
      or ((.formalScoreScope != "vacancy-plan-only") and (.formalScoreScope != "special-path-only"))
      or ((.formalScoreScope == "special-path-only") and ((.specialPathReason // "") == ""))
      or has("minScore")
      or has("minRank")
      or has("minRankEnd")
    )) | length) != 0) then
    error("v3.272 records violate vacancy-plan field boundaries")
  else
    .generatedAt = $payload.generatedAt
    | .modelVersion = $versionId
    | .modelPolicy.version = $versionId
    | .sourceFiles = (((.sourceFiles // []) + [$importPath]) | unique | sort)
    | .admissionScoreLayer.records += $newRecords
    | .admissionScoreLayer.structuredRecords += $recordDelta
    | .admissionScoreLayer.admissionPlanRecords += $recordDelta
    | .admissionScoreLayer.vacancyPlanRecords = ((.admissionScoreLayer.vacancyPlanRecords // 0) + $recordDelta)
    | .admissionScoreLayer.vacancyPlanSnapshotCount = ((.admissionScoreLayer.vacancyPlanSnapshotCount // 0) + $snapshotDelta)
    | .admissionScoreLayer.ordinaryVocationalVacancyRecords = ((.admissionScoreLayer.ordinaryVocationalVacancyRecords // 0) + $ordinaryVocationalDelta)
    | .admissionScoreLayer.sourceNotes += [$vacancySource, $scheduleSource]
    | .admissionScoreLayer.statusLabel = ("已接入" + (.admissionScoreLayer.structuredRecords | tostring) + "条结构化录取/计划数据 + " + (.admissionScoreLayer.rankConversionRecords | tostring) + "条一分一段记录")
    | .admissionScoreLayer.currentFinding = $finding
    | .admissionScoreLayer.availableEvidenceIds = (((.admissionScoreLayer.availableEvidenceIds // []) + [$vacancySource.id, $scheduleSource.id]) | unique | sort)
    | .admissionScoreLayer.downgradeReason = "西藏2025征集志愿计划可用于识别历史补录机会，但不含录取最低分/位次；2026当前按考试院日程分批录取，普通类一分一段、省级全量投档/录取表、专业最低位次和高职专科正式投档仍待补齐。"
    | .admissionScoreLayer.coverage.records = .admissionScoreLayer.structuredRecords
    | .admissionScoreLayer.coverage.rawRecords = .admissionScoreLayer.structuredRecords
    | .admissionScoreLayer.coverage.files = ((.admissionScoreLayer.coverage.files // 0) + 37)
    | .admissionScoreLayer.coverage.dataTypes["admission-plan"] += $recordDelta
    | .admissionScoreLayer.coverage.vacancyPlanRecords = ((.admissionScoreLayer.coverage.vacancyPlanRecords // 0) + $recordDelta)
    | .admissionScoreLayer.coverage.vacancyPlanSnapshotCount = ((.admissionScoreLayer.coverage.vacancyPlanSnapshotCount // 0) + $snapshotDelta)
    | .admissionScoreLayer.coverage.ordinaryVocationalVacancyRecords = ((.admissionScoreLayer.coverage.ordinaryVocationalVacancyRecords // 0) + $ordinaryVocationalDelta)
    | .admissionScoreLayer.coverage.provinces |= add_unique_sorted(["西藏"])
    | .admissionScoreLayer.coverage.years |= add_unique_sorted([2025, 2026])
    | .admissionScoreLayer.coverage.schools |= add_unique_sorted($newRecords | map(.schoolName))
    | .admissionScoreLayer.provinceReadiness.rows |= update_xizang_readiness($recordDelta; $snapshotDelta; $ordinaryVocationalDelta)
    | .admissionScoreLayer.coverage.provinceReadiness.rows |= update_xizang_readiness($recordDelta; $snapshotDelta; $ordinaryVocationalDelta)
  end

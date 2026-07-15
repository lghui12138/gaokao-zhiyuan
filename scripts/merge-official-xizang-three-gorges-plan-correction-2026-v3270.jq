($imp[0]) as $payload
| ($payload.sourceNotes[0]) as $sourceNote
| ($payload.corrections[0]) as $correction
| (.admissionScoreLayer.records | map(select(.id == $correction.targetId))) as $matches
| if (($payload.corrections | length) != 1) then
    error("expected exactly one correction")
  elif (($payload.sourceNotes | length) != 1) then
    error("expected exactly one source note")
  elif ((.admissionScoreLayer.sourceNotes | map(.id) | index($sourceNote.id)) != null) then
    error("duplicate sourceNote id: " + $sourceNote.id)
  elif (($matches | length) != 1) then
    error("target record count must be exactly one: " + (($matches | length) | tostring))
  elif (($matches[0].schoolCode | tostring) != $correction.before.schoolCode)
    or ($matches[0].schoolName != $correction.before.schoolName)
    or (($matches[0].majorCode | tostring) != $correction.before.majorCode)
    or ($matches[0].majorName != $correction.before.majorName)
    or (($matches[0].planCount | tonumber) != $correction.before.planCount)
    or (($matches[0].tuition | tostring) != $correction.before.tuition)
    or (($matches[0].programDuration // $correction.before.duration) != $correction.before.duration)
    or (($matches[0].planRemark // $correction.before.remark) != $correction.before.remark) then
    error("target record no longer matches the official before-state")
  else
    .generatedAt = $payload.generatedAt
    | .modelVersion = $versionId
    | .modelPolicy.version = $versionId
    | .sourceFiles = (((.sourceFiles // []) + [$importPath]) | unique | sort)
    | .admissionScoreLayer.records = (.admissionScoreLayer.records | map(
        if .id == $correction.targetId then
          . as $old
          | .schoolCode = $correction.after.schoolCode
          | .schoolName = $correction.after.schoolName
          | .schoolTags = (((.schoolTags // []) + ["中外合作办学", "官方计划更正"]) | unique)
          | .originalSchoolCode = ($old.schoolCode | tostring)
          | .originalSchoolName = $old.schoolName
          | .originalSourceId = $old.sourceId
          | .originalSourceQuality = $old.sourceQuality
          | .sourceId = $sourceNote.id
          | .sourceQuality = $sourceNote.quality
          | .sourceUrl = $sourceNote.url
          | .sourcePublishedAt = $sourceNote.publishedAt
          | .correctionSourceId = $sourceNote.id
          | .planCorrectionNote = $correction.planCorrectionNote
          | .planRestrictionText = $correction.planRestrictionText
          | .programDuration = $correction.after.duration
          | .planRemark = $correction.after.remark
          | .cautions = [
              "官方更正：院校代码/名称由0329 三峡大学改为1466 三峡大学(中外合作办学)，专业、计划数和学费不变。",
              "录取后不得调换专业，该专业教学外语为英语。",
              "该记录只有招生计划数，不含投档/录取最低分或最低位次，不能单独计算录取概率。"
            ]
        else
          .
        end
      ))
    | .admissionScoreLayer.sourceNotes += [$sourceNote]
    | .admissionScoreLayer.structuredRecords = (.admissionScoreLayer.records | length)
    | .admissionScoreLayer.statusLabel = ("已接入" + (.admissionScoreLayer.structuredRecords | tostring) + "条结构化录取/计划数据 + " + (.admissionScoreLayer.rankConversionRecords | tostring) + "条一分一段记录")
    | .admissionScoreLayer.currentFinding = $finding
    | .admissionScoreLayer.availableEvidenceIds = (((.admissionScoreLayer.availableEvidenceIds // []) + [$sourceNote.id]) | unique | sort)
    | .admissionScoreLayer.downgradeReason = ("当前数据层 " + $versionId + " 已接入西藏2026招生计划官方更正，但该记录仍只有计划层证据；西藏普通批全量投档/录取表、一分一段、专业最低位次和高职专科投档仍待补齐。")
    | .admissionScoreLayer.coverage.records = .admissionScoreLayer.structuredRecords
    | .admissionScoreLayer.coverage.rawRecords = .admissionScoreLayer.structuredRecords
    | .admissionScoreLayer.coverage.files = ((.admissionScoreLayer.coverage.files // 0) + ($sourceNote.rawFiles | length))
  end

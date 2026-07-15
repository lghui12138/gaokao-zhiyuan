export function splitAdmissionPayloadRecords(payload = {}) {
  const admissionRecords = [];
  const rankRecords = [];

  for (const record of Array.isArray(payload.records) ? payload.records : []) {
    if (record?.dataType === "rank-conversion") rankRecords.push(record);
    else admissionRecords.push(record);
  }
  for (const record of Array.isArray(payload.rankConversions) ? payload.rankConversions : []) {
    if (record && typeof record === "object") rankRecords.push(record);
  }

  return { admissionRecords, rankRecords };
}

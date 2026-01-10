// src/model/schemas.js
// Strict runtime validators (no external deps).

function isObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function isString(v) {
  return typeof v === 'string';
}

function isBoolean(v) {
  return typeof v === 'boolean';
}

function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function fail(operation, msg) {
  const e = new Error(msg);
  e.name = 'SchemaValidationError';
  e.operation = operation;
  throw e;
}

export function validateModelResponse(operation, obj) {
  if (!isObject(obj)) fail(operation, 'Model response is not an object');
  if (!('ok' in obj) || !isBoolean(obj.ok)) fail(operation, 'Missing/invalid ok');
  if (obj.operation !== operation) fail(operation, 'operation mismatch');

  switch (operation) {
    case 'VALIDATE_WISH': {
      if (!('valid' in obj) || !isBoolean(obj.valid)) fail(operation, 'Missing/invalid valid');
      if (!('reasons' in obj) || !isStringArray(obj.reasons)) fail(operation, 'Missing/invalid reasons');
      if (!(obj.sanitized_text === null || isString(obj.sanitized_text))) fail(operation, 'Missing/invalid sanitized_text');
      return obj;
    }

    case 'CREATE_WISH_PAYLOAD': {
      if (!('db_payload' in obj) || !isObject(obj.db_payload)) fail(operation, 'Missing/invalid db_payload');
      const p = obj.db_payload;
      if (!(p.user_id === null || isString(p.user_id))) fail(operation, 'db_payload.user_id invalid');
      if (!isString(p.text)) fail(operation, 'db_payload.text invalid');
      if (!isBoolean(p.is_public)) fail(operation, 'db_payload.is_public invalid');
      if (!('tags' in p) || !isStringArray(p.tags)) fail(operation, 'db_payload.tags invalid');
      if (!(p.summary === null || isString(p.summary))) fail(operation, 'db_payload.summary invalid');
      if (!('error_code' in obj) || !(obj.error_code === null || isString(obj.error_code))) fail(operation, 'error_code invalid');
      if (!('error_msg' in obj) || !(obj.error_msg === null || isString(obj.error_msg))) fail(operation, 'error_msg invalid');
      return obj;
    }

    case 'RECORD_GIFT_OPEN': {
      if (!('db_payload' in obj) || !isObject(obj.db_payload)) fail(operation, 'Missing/invalid db_payload');
      const p = obj.db_payload;
      if (!(p.user_id === null || isString(p.user_id))) fail(operation, 'db_payload.user_id invalid');
      if (!isString(p.gift_id)) fail(operation, 'db_payload.gift_id invalid');
      if (!isString(p.opened_at)) fail(operation, 'db_payload.opened_at invalid');
      if (!('error_code' in obj) || !(obj.error_code === null || isString(obj.error_code))) fail(operation, 'error_code invalid');
      if (!('error_msg' in obj) || !(obj.error_msg === null || isString(obj.error_msg))) fail(operation, 'error_msg invalid');
      return obj;
    }

    case 'GENERATE_GIFT_SUMMARY': {
      if (!(obj.summary_text === null || isString(obj.summary_text))) fail(operation, 'summary_text invalid');
      return obj;
    }

    case 'FETCH_USER_GIFTS': {
      if (!('gift_ids' in obj) || !isStringArray(obj.gift_ids)) fail(operation, 'gift_ids invalid');
      return obj;
    }

    default:
      fail(operation, `Unknown operation: ${operation}`);
  }
}

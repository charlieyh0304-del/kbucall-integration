#!/usr/bin/env node
/**
 * 복지콜 예약 API 참조 구현.
 *
 * API.md의 "접수 전 확인 의무"를 그대로 구현한 것이라, 여기 있는 순서를 그대로
 * 가져다 쓰면 됩니다. 의존성이 없고 Node 18 이상이면 바로 돌아갑니다.
 *
 * 출력은 전부 평문 한 줄씩입니다. 색, 스피너, 박스 문자를 쓰지 않습니다 —
 * 스크린리더로 읽을 때 방해가 되기 때문입니다.
 *
 *   node book.mjs --pickup "둔촌동 1376-1" --dropoff "여의도동 2" --at +5m
 *   node book.mjs --pickup "경복궁" --dropoff "서울맹학교" --at 14:30 --dry-run
 *
 * 자격증명은 환경변수로 받습니다.
 *   KBUCALL_NAME, KBUCALL_PHONE, KBUCALL_PASSWORD
 * 또는 이미 받아둔 토큰이 있으면
 *   KBUCALL_TOKEN
 *
 * --dry-run 은 접수 직전까지만 하고 멈춥니다. 실제 차량을 부르지 않고
 * 로그인·주소 확인·시각 계산이 제대로 되는지 확인할 때 쓰세요.
 */

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const BASE = process.env.KBUCALL_BASE || 'https://kbucall.pages.dev';

/**
 * 사용자에게 물어볼 수 있는 상황인지. 파이프로 실행되거나 에이전트가 부른 경우
 * 답을 받을 수 없으므로, 확인이 필요한 지점에서는 접수하지 않고 멈춘다.
 */
function canAsk() {
  return Boolean(stdin.isTTY);
}

// ---------- 인자 ----------

function parseArgs(argv) {
  const args = { dryRun: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--yes') args.yes = true;
    else if (a === '--pickup') args.pickup = argv[++i];
    else if (a === '--dropoff') args.dropoff = argv[++i];
    else if (a === '--at') args.at = argv[++i];
    else if (a === '--via') args.via = argv[++i];
    else {
      throw new Error(`알 수 없는 인자: ${a}`);
    }
  }
  if (!args.pickup) throw new Error('--pickup 이 필요합니다');
  if (!args.dropoff) throw new Error('--dropoff 이 필요합니다');
  return args;
}

/** "+5m" 또는 "14:30" 또는 "2026-09-24T14:30" 을 ISO 문자열로. 생략하면 5분 뒤. */
function resolveRunAt(at) {
  if (!at) return new Date(Date.now() + 5 * 60_000).toISOString();

  const rel = at.match(/^\+(\d+)m$/);
  if (rel) return new Date(Date.now() + Number(rel[1]) * 60_000).toISOString();

  const hhmm = at.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    const d = new Date();
    d.setHours(Number(hhmm[1]), Number(hhmm[2]), 0, 0);
    if (d.getTime() < Date.now()) {
      throw new Error(`${at} 은 이미 지난 시각입니다. 날짜까지 지정하거나 +N분 형식을 쓰세요.`);
    }
    return d.toISOString();
  }

  // 시간대 접미사 없는 문자열은 기기 로컬 시간대로 해석됩니다.
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) throw new Error(`시각을 이해하지 못했습니다: ${at}`);
  return d.toISOString();
}

// ---------- HTTP ----------

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`응답을 읽지 못했습니다 (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    // error 메시지는 그대로 사용자에게 읽어줘도 되는 한국어 문장입니다.
    const err = new Error(json.error || `HTTP ${res.status}`);
    Object.assign(err, json, { status: res.status });
    throw err;
  }
  return json;
}

// ---------- 1. 로그인 ----------

async function login() {
  if (process.env.KBUCALL_TOKEN) {
    console.log('보관된 토큰을 씁니다.');
    return process.env.KBUCALL_TOKEN;
  }
  const memberName = process.env.KBUCALL_NAME;
  const phone = process.env.KBUCALL_PHONE;
  const password = process.env.KBUCALL_PASSWORD;
  if (!memberName || !phone || !password) {
    throw new Error('KBUCALL_NAME, KBUCALL_PHONE, KBUCALL_PASSWORD 환경변수가 필요합니다.');
  }

  const out = await call('/api/auth/kbucall-login', {
    method: 'POST',
    body: { memberName, phone, password },
  });
  console.log(`로그인 성공: ${out.memberName}`);
  // 비밀번호는 보관하지 않습니다. 토큰만 있으면 90일 동안 씁니다.
  return out.token;
}

// ---------- 2. 주소 확인 ----------

/**
 * 입력 문자열을 복지콜이 받아들이는 주소로 확정한다.
 *
 * 후보가 여럿이면 반드시 사용자가 고르게 한다. 첫 후보를 자동으로 고르면
 * 같은 동 이름이 있는 다른 도시로 차가 갈 수 있다.
 */
async function resolveAddress(label, query, token, rl, autoYes) {
  const out = await call(`/api/kbucall/place?query=${encodeURIComponent(query)}`, { token });

  if (!out.results || out.results.length === 0) {
    throw new Error(`${label} "${query}" 주소를 찾을 수 없습니다. 더 구체적으로 입력해주세요.`);
  }

  let chosen = out.results[0];

  if (out.ambiguous && Array.isArray(out.candidates) && out.candidates.length > 0) {
    console.log(`${label} "${query}" 이(가) 여러 곳에서 검색되었습니다. ${out.candidates.length}개 중에서 고르세요.`);
    out.candidates.forEach((c, i) => {
      console.log(`${i + 1}. ${c.address}${c.jibun && c.jibun !== c.address ? ` (지번 ${c.jibun})` : ''}`);
    });
    // 사람이 고를 수 없는 상황(비대화형 실행, --yes)이면 접수하지 않는다.
    // 임의로 첫 후보를 고르면 같은 동 이름이 있는 다른 지역으로 차가 간다.
    if (autoYes || !canAsk()) {
      throw new Error(
        `${label} 후보가 여러 개라 자동으로 진행할 수 없습니다. `
        + '위 후보 중 하나를 사용자에게 고르게 한 뒤 그 주소를 그대로 넘겨 다시 실행하세요.',
      );
    }
    const answer = await rl.question(`${label} 번호를 입력하세요: `);
    const idx = Number(answer.trim()) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= out.candidates.length) {
      throw new Error('번호를 잘못 입력했습니다.');
    }
    chosen = out.candidates[idx];
  }

  // 번지가 없으면 접수하지 않는다. 복지콜 콜센터가 전화로 위치를 다시 확인하게 되어
  // 사용자가 전화를 받아야 하는 상황이 생긴다. 복지콜 앱 화면도 같은 이유로 차단한다.
  if (out.hasAddressNumber === false) {
    throw new Error(
      `${label} "${chosen.address}" 에 번지가 확인되지 않았습니다. `
      + '번지를 포함해 다시 입력해주세요. 예: "구로구 오류동 126-1"',
    );
  }

  const resolved = chosen.address;
  const jibun = chosen.jibun && chosen.jibun !== resolved ? ` (지번 ${chosen.jibun})` : '';
  console.log(`${label} 확정: ${resolved}${jibun}`);
  return resolved;
}

// ---------- 3. 접수 ----------

async function book({ token, runAt, pickup, dropoff, via }) {
  const id = crypto.randomUUID();
  await call('/api/data/bookings', {
    method: 'POST',
    token,
    body: {
      id,
      runAt,
      pickupQuery: pickup,
      dropoffQuery: dropoff,
      ...(via ? { viaQuery: via } : {}),
      status: 'pending',
      source: 'kbucall-example-cli',
    },
  });
  return id;
}

// ---------- 4. 상태 확인 ----------

const PHASE_TEXT = {
  submitted: '접수됨, 차량 검색 전',
  searching: '차량 검색 중',
  dispatched: '차량 배정, 이동 중',
  boarding: '탑승 후 운행 중',
  disembarked: '하차 완료',
};

async function waitForResult(token, id, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let announcedRunning = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    let booking;
    try {
      ({ booking } = await call(`/api/data/bookings?id=${encodeURIComponent(id)}`, { token }));
    } catch {
      continue; // 일시 오류는 다음 폴링에서 재시도
    }
    if (!booking) continue;
    if (booking.status === 'running' && !announcedRunning) {
      announcedRunning = true;
      console.log('복지콜 서버에 접수 요청 중입니다.');
    }
    if (booking.status === 'success' || booking.status === 'failed') return booking;
  }
  return null;
}

// ---------- 실행 ----------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runAt = resolveRunAt(args.at);
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    const token = await login();

    const pickup = await resolveAddress('출발지', args.pickup, token, rl, args.yes);
    const dropoff = await resolveAddress('도착지', args.dropoff, token, rl, args.yes);
    const via = args.via ? await resolveAddress('경유지', args.via, token, rl, args.yes) : undefined;

    // 최종 확인. 접수는 실제로 차량이 배차되는 동작이라 사람이 한 번 더 확인한다.
    const when = new Date(runAt);
    const whenText = `${when.getFullYear()}년 ${when.getMonth() + 1}월 ${when.getDate()}일 ${when.getHours()}시 ${String(when.getMinutes()).padStart(2, '0')}분`;
    console.log('');
    console.log('접수할 내용입니다.');
    console.log(`출발지: ${pickup}`);
    if (via) console.log(`경유지: ${via}`);
    console.log(`도착지: ${dropoff}`);
    console.log(`시각: ${whenText}`);
    console.log('');

    if (args.dryRun) {
      console.log('--dry-run 이라 여기서 멈춥니다. 실제 접수는 하지 않았습니다.');
      return;
    }

    if (!args.yes) {
      if (!canAsk()) {
        throw new Error(
          '접수 전 사용자 확인을 받을 수 없는 환경입니다. 위 내용을 사용자에게 확인받은 뒤 '
          + '--yes 를 붙여 다시 실행하세요.',
        );
      }
      const ok = await rl.question('이대로 접수할까요? (y/N) ');
      if (ok.trim().toLowerCase() !== 'y') {
        console.log('접수하지 않았습니다.');
        return;
      }
    }

    const id = await book({ token, runAt, pickup, dropoff, via });
    console.log(`예약이 등록되었습니다. 예약 번호 ${id}`);

    // runAt이 5분 이내면 서버가 즉시 접수를 시작하므로 결과를 기다린다.
    if (new Date(runAt).getTime() <= Date.now() + 5 * 60_000) {
      const result = await waitForResult(token, id);
      if (!result) {
        console.log('접수가 평소보다 오래 걸리고 있습니다. 잠시 후 다시 확인해주세요.');
      } else if (result.status === 'success') {
        console.log('접수 완료되었습니다.');
        if (result.callPhase) console.log(`현재 단계: ${PHASE_TEXT[result.callPhase] || result.callPhase}`);
      } else {
        console.log(`접수 실패. ${result.errorMessage || '알 수 없는 오류'}`);
        process.exitCode = 1;
      }
    } else {
      console.log('예약한 시각이 되면 자동으로 접수됩니다.');
    }
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error(`오류: ${err.message}`);
  if (err.remainingAttempts !== undefined) {
    console.error(`남은 시도 횟수: ${err.remainingAttempts}`);
  }
  if (err.lockedOut) {
    console.error('로그인 시도가 제한되었습니다. 잠시 후 다시 시도해주세요.');
  }
  process.exitCode = 1;
});

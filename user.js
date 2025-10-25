// ==UserScript==
// @name         GeoFS Flightradar (ATC Reporter with Enhanced + Flight Info + Takeoff Time + Squawk)
// @namespace    http://tampermonkey.net/
// @version      1.8
// @description  傳送玩家位置/航班資訊到 ATC Server；ALT=AGL；UI可輸入Dep/Arr/FlightNo/Squawk；按W收合；自動偵測Takeoff UTC
// @author       SeaBus, GeoFS Explorer
// @match        http://*/geofs.php*
// @match        https://*/geofs.php*
// @updateURL    https://github.com/seabus0316/GeoFS-flightradar/raw/refs/heads/main/user.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /*** CONFIG ***/
  const WS_URL = 'https://geofs-flightradar.onrender.com/';
  const SEND_INTERVAL_MS = 500;
  /*************/

  function log(...args) {
    console.log('[ATC-Reporter]', ...args);
  }

  let flightInfo = { departure: '', arrival: '', flightNo: '', squawk: '' };
  let flightUI;
  let wasOnGround = true;
  let takeoffTimeUTC = '';

  let ws;
  function connect() {
    try {
      ws = new WebSocket(WS_URL);
      ws.addEventListener('open', () => {
        log('WS connected');
        safeSend({ type: 'hello', role: 'player' });
      });
      ws.addEventListener('close', () => {
        log('WS closed, retrying...');
        setTimeout(connect, 2000);
      });
      ws.addEventListener('error', (e) => {
        console.warn('[ATC-Reporter] WS error', e);
        try { ws.close(); } catch {}
      });
    } catch (e) {
      console.warn('[ATC-Reporter] WS connect error', e);
      setTimeout(connect, 2000);
    }
  }
  connect();

  function safeSend(obj) {
    try {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
    } catch (e) {
      console.warn('[ATC-Reporter] send error', e);
    }
  }

  function getAircraftName() {
    return geofs?.aircraft?.instance?.aircraftRecord?.name || 'Unknown';
  }
  function getPlayerCallsign() {
    return geofs?.userRecord?.callsign || 'Unknown';
  }
  function calculateAGL() {
    try {
      const altitudeMSL = geofs?.animation?.values?.altitude;
      const groundElevationFeet = geofs?.animation?.values?.groundElevationFeet;
      const aircraft = geofs?.aircraft?.instance;

      if (
        typeof altitudeMSL === 'number' &&
        typeof groundElevationFeet === 'number' &&
        aircraft?.collisionPoints?.length >= 2 &&
        typeof aircraft.collisionPoints[aircraft.collisionPoints.length - 2]?.worldPosition?.[2] === 'number'
      ) {
        const collisionZFeet = aircraft.collisionPoints[aircraft.collisionPoints.length - 2].worldPosition[2] * 3.2808399;
        return Math.round((altitudeMSL - groundElevationFeet) + collisionZFeet);
      }
    } catch (err) {
      console.warn('[ATC-Reporter] AGL calculation error:', err);
    }
    return null;
  }

  function checkTakeoff() {
    const onGround = geofs?.aircraft?.instance?.groundContact ?? true;
    if (wasOnGround && !onGround) {
      takeoffTimeUTC = new Date().toISOString();
      console.log('[ATC-Reporter] Takeoff at', takeoffTimeUTC);
    }
    wasOnGround = onGround;
  }

  function readSnapshot() {
    try {
      const inst = geofs?.aircraft?.instance;
      if (!inst) return null;

      const lla = inst.llaLocation || [];
      const lat = lla[0];
      const lon = lla[1];
      const altMeters = lla[2];

      if (typeof lat !== 'number' || typeof lon !== 'number') return null;

      const altMSL = (typeof altMeters === 'number') ? altMeters * 3.28084 : geofs?.animation?.values?.altitude ?? 0;
      const altAGL = calculateAGL();
      const heading = geofs?.animation?.values?.heading360 ?? 0;
      const speed =  geofs.animation.values.kias ? geofs.animation.values.kias.toFixed(1) : 'N/A';

      return { lat, lon, altMSL, altAGL, heading, speed };
    } catch (e) {
      console.warn('[ATC-Reporter] readSnapshot error:', e);
      return null;
    }
  }

  function buildPayload(snap) {
  checkTakeoff();
  let flightPlan = [];
  try {
    if (geofs.flightPlan && typeof geofs.flightPlan.export === "function") {
      flightPlan = geofs.flightPlan.export();
    }console.log('[ATC-Reporter] FlightPlan:', flightPlan);
  } catch (e) {}
  return {
    id: getPlayerCallsign(),
    callsign: getPlayerCallsign(),
    type: getAircraftName(),
    lat: snap.lat,
    lon: snap.lon,
    alt: (typeof snap.altAGL === 'number') ? snap.altAGL : Math.round(snap.altMSL || 0),
    altMSL: Math.round(snap.altMSL || 0),
    heading: Math.round(snap.heading || 0),
    speed: Math.round(snap.speed || 0),
    flightNo: flightInfo.flightNo,
    departure: flightInfo.departure,
    arrival: flightInfo.arrival,
    takeoffTime: takeoffTimeUTC,
    squawk: flightInfo.squawk,
    flightPlan: flightPlan
  };
}

  setInterval(() => {
    if (!ws || ws.readyState !== 1) return;
    const snap = readSnapshot();
    if (!snap) return;
    const payload = buildPayload(snap);
    safeSend({ type: 'position_update', payload });
  }, SEND_INTERVAL_MS);

  function showToast(msg) {
    const toast = document.createElement('div');
    toast.textContent = msg;
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.right = '20px';
    toast.style.background = 'rgba(0,0,0,0.8)';
    toast.style.color = '#fff';
    toast.style.padding = '8px 12px';
    toast.style.borderRadius = '6px';
    toast.style.fontSize = '13px';
    toast.style.zIndex = 1000000;
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; });
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  // --- UI 注入 ---
  function injectFlightUI() {
    flightUI = document.createElement('div');
    flightUI.id = 'flightInfoUI';
    flightUI.style.position = 'fixed';
    flightUI.style.bottom = '280px';
    flightUI.style.right = '6px';
    flightUI.style.background = 'rgba(0,0,0,0.6)';
    flightUI.style.padding = '6px';
    flightUI.style.borderRadius = '6px';
    flightUI.style.color = 'white';
    flightUI.style.fontSize = '11px';
    flightUI.style.zIndex = 999999;
    flightUI.style.minWidth = '120px';

    flightUI.innerHTML = `
      <div style="margin-bottom:4px">Dep: <input id="depInput" style="width:50px;font-size:10px;padding:1px;"></div>
      <div style="margin-bottom:4px">Arr: <input id="arrInput" style="width:50px;font-size:10px;padding:1px;"></div>
      <div style="margin-bottom:4px">Flt#: <input id="fltInput" style="width:50px;font-size:10px;padding:1px;"></div>
      <div style="margin-bottom:4px">SQK: <input id="sqkInput" style="width:50px;font-size:10px;padding:1px;" maxlength="4"></div>
      <div style="display:flex;justify-content:space-between;gap:2px;">
        <button id="saveBtn" style="font-size:10px;padding:2px 4px;">Save</button>
        <button id="openBtn" style="font-size:10px;padding:2px 4px;">Open Site</button>
      </div>
    `;

    document.body.appendChild(flightUI);

    ['depInput','arrInput','fltInput','sqkInput'].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener('input', () => {
        el.value = el.value.toUpperCase();
      });
    });

    document.getElementById('saveBtn').onclick = () => {
      flightInfo.departure = document.getElementById('depInput').value.trim();
      flightInfo.arrival = document.getElementById('arrInput').value.trim();
      flightInfo.flightNo = document.getElementById('fltInput').value.trim();
      flightInfo.squawk = document.getElementById('sqkInput').value.trim();
      showToast('Flight info saved!');
    };

    document.getElementById('openBtn').onclick = () => {
      window.open('https://geofs-flightradar.onrender.com', '_blank');
    };
  }
  injectFlightUI();

  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'w') {
      if (flightUI.style.display === 'none') {
        flightUI.style.display = 'block';
        showToast('Flight Info UI Shown');
      } else {
        flightUI.style.display = 'none';
        showToast('Flight Info UI Hidden');
      }
    }
  });

  document.querySelectorAll("input").forEach(el => {
    el.setAttribute("autocomplete", "off");
  });

  document.addEventListener("keydown", (e) => {
    const target = e.target;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
      e.stopPropagation();
    }
  }, true);

})();


// Generated from TypeScript; run npm run build:runtime -- --publish. Do not edit.
"use strict";
(() => {
  // runtime/roster/character-order.ts
  function orderCharacters(characters, roster, primary, merchant, steam = []) {
    const order = new Map(roster.map((member, index) => [member.name, index]));
    const steamNames = new Set(steam);
    const rank = (member) => {
      if (member.name === primary) return 0;
      if (member.name === merchant || member.ctype === "merchant") return 3;
      return steamNames.has(member.name) ? 1 : 2;
    };
    return characters.slice().sort(
      (a, b) => rank(a) - rank(b) || (order.get(a.name) ?? Infinity) - (order.get(b.name) ?? Infinity) || a.name.localeCompare(b.name)
    );
  }

  // runtime/steam/switcher.ts
  var minimizedKey = "party-steam-minimized-v1";
  var buttonStyle = "font:inherit;background:#242424;color:#fff;border:2px solid #888;border-radius:0;padding:3px 6px;cursor:pointer;box-shadow:inset -2px -2px #080808;line-height:20px";
  function createSwitcher(host, action) {
    const panel = host.document.createElement("section");
    panel.id = "party-console-switcher";
    panel.setAttribute("aria-label", "Party Console Steam view");
    host.document.body.append(panel);
    let minimized = host.localStorage?.getItem(minimizedKey) === "1";
    let minimizedPosition = null;
    let dialog = null, latest = null, busy = false;
    function button(text, title, click) {
      const b = host.document.createElement("button");
      b.textContent = text;
      b.title = title;
      b.setAttribute("aria-label", title);
      b.style.cssText = buttonStyle;
      b.onclick = click;
      b.onmouseenter = () => {
        b.style.backgroundColor = "#484848";
      };
      b.onmouseleave = () => {
        b.style.backgroundColor = "#242424";
      };
      return b;
    }
    function close() {
      dialog?.remove();
      dialog = null;
    }
    function popup(title, description, confirm) {
      if (dialog) return;
      dialog = host.document.createElement("dialog");
      dialog.style.cssText = "background:#151515;color:#fff;border:4px solid #aaa;padding:16px;font:24px Pixel,monospace;max-width:440px";
      dialog.setAttribute("aria-label", title);
      const h = host.document.createElement("div");
      h.textContent = title;
      const p = host.document.createElement("p");
      p.textContent = description;
      const cancel = button(confirm ? "Cancel" : "OK", confirm ? "Cancel" : "OK", close);
      dialog.append(h, p, cancel);
      if (confirm) dialog.append(button("Confirm", "Confirm", () => {
        close();
        confirm();
      }));
      dialog.oncancel = close;
      host.document.body.append(dialog);
      dialog.showModal();
      cancel.focus();
    }
    function request(name, kind) {
      if (busy || latest?.operation && latest.operation.phase !== "complete") return;
      const member = latest?.members.find((m) => m.name === name);
      if (!member) return;
      if (kind === "login" && latest.members.filter((m) => m.hosting && m.hosting !== "offline").length >= 4) {
        popup("maximum characters logged in", "");
        return;
      }
      const execute = () => {
        if (latest?.operation && latest.operation.phase !== "complete") return;
        if (latest?.members.find((m) => m.name === name)?.hosting !== member.hosting) {
          popup("Character session changed", "Choose the action again.");
          return;
        }
        busy = true;
        render();
        void action(name, kind).catch((error) => popup("Character operation failed", String(error))).finally(() => {
          busy = false;
          render();
        });
      };
      if (kind === "login") {
        execute();
        return;
      }
      popup(
        kind === "primary" ? `Make ${name} Steam Primary?` : kind === "headless" ? `Run ${name} headless?` : `Log out ${name}?`,
        kind === "primary" ? "Other Steam characters briefly reconnect, then continue in Steam. Other headless characters stay headless." : kind === "headless" ? "This character moves to caracAL. If primary, another Steam character becomes primary and the Steam group briefly reconnects." : "Stop this character and its routine. Removing the primary briefly reconnects the remaining Steam characters.",
        execute
      );
    }
    function render() {
      panel.replaceChildren();
      panel.style.cssText = `position:fixed;top:${minimized && minimizedPosition ? minimizedPosition.top - 3 : 8}px;left:${minimized && minimizedPosition ? minimizedPosition.left - 3 + "px" : "50%"};transform:${minimized && minimizedPosition ? "none" : "translateX(-50%)"};max-width:calc(100vw - 16px);z-index:999999;background:#111;color:#fff;border:3px solid #888;padding:${minimized ? "0" : "5px"};box-sizing:border-box;font:24px Pixel,monospace;line-height:24px`;
      const toggle = button("_", minimized ? "Restore Steam character controls" : "Minimize Steam character controls", () => {
        if (!minimized) {
          const bounds = toggle.getBoundingClientRect();
          minimizedPosition = { left: bounds.left, top: bounds.top };
        }
        minimized = !minimized;
        host.localStorage?.setItem(minimizedKey, minimized ? "1" : "0");
        render();
      });
      if (minimized) {
        panel.append(toggle);
        return;
      }
      const header = host.document.createElement("div");
      header.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:20px";
      const title = host.document.createElement("span");
      title.textContent = "Characters";
      const controls = host.document.createElement("div");
      controls.style.cssText = "display:flex;gap:4px";
      const all = button("X", "Run all Steam characters headless", () => popup(
        "Log out all characters from Steam and run on the headless device?",
        "Characters move one at a time, with Steam primary last. Wait for completion before closing Steam.",
        () => {
          busy = true;
          render();
          void action("", "headless-all").catch((error) => popup("Headless handoff failed", String(error))).finally(() => {
            busy = false;
            render();
          });
        }
      ));
      all.disabled = busy || !latest?.members.some((member) => member.hosting === "steam") || !!latest?.operation && latest.operation.phase !== "complete";
      controls.append(toggle, all);
      header.append(title, controls);
      panel.append(header);
      const list = host.document.createElement("div");
      list.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;max-height:160px;overflow:auto";
      const pending = busy || !!latest?.operation && latest.operation.phase !== "complete";
      const members = latest?.members || [];
      const steam = members.filter((member) => member.hosting === "steam").map((member) => member.name);
      for (const member of orderCharacters(members, members, latest?.primary, null, steam)) {
        const hosting = member.hosting || (member.online ? "headless" : "offline");
        const primary = member.name === latest?.primary && hosting === "steam" && member.online;
        const row = host.document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:4px;border:2px solid #555;padding:3px;background:#171717";
        const name = button(member.name, primary ? "This character has primary Steam control" : "Give this character primary Steam control", () => request(member.name, "primary"));
        name.style.color = !member.online ? "#888" : primary ? "#50ee50" : "#fff";
        name.disabled = pending || primary || !member.online;
        const hostButton = button(
          hosting === "steam" ? "\u2713" : hosting === "headless" ? "H" : "\u25A1",
          hosting === "steam" ? `Run ${member.name} headless` : hosting === "headless" ? `Make ${member.name} Steam Primary` : "Offline",
          () => request(member.name, hosting === "steam" ? "headless" : "primary")
        );
        hostButton.style.color = hosting === "steam" ? "#50ee50" : "#fff";
        hostButton.disabled = pending || hosting === "offline";
        const session = button(
          hosting === "offline" ? "\u21AA" : "\u23FB",
          `${hosting === "offline" ? "Log in" : "Log out"} ${member.name}`,
          () => request(member.name, hosting === "offline" ? "login" : "logout")
        );
        session.disabled = pending;
        row.append(name, hostButton, session);
        list.append(row);
      }
      panel.append(list);
    }
    return { dispose() {
      close();
      panel.remove();
    }, render(reply) {
      latest = reply;
      render();
    } };
  }

  // runtime/steam/connection.ts
  var steamBridgeVersion = 12;
  function serverAddress(host = globalThis) {
    return (host.__partyServer || host.parent?.__partyServer || "http://127.0.0.1:924").replace(
      /\/$/,
      ""
    );
  }
  function steamBootstrap(base) {
    return `$.getScript(${JSON.stringify(base.replace(/\/$/, "") + "/CODE/adventure_land/universal-loader.js")});`;
  }
  function previousSteamBootstrap(base) {
    return `/* party-managed-bootstrap-v2 */
globalThis.__partyServer=${JSON.stringify(base)};parent.__partyServer=globalThis.__partyServer;
(function(){
 if(globalThis.__partyBootstrapPending||globalThis.__partyCodeLoader)return;
 globalThis.__partyBootstrapPending=true;
 var delay=1000,base=globalThis.__partyServer+"/CODE/adventure_land/";
 async function download(file){var r=await fetch(base+file+"?t="+Date.now(),{cache:"no-store",signal:AbortSignal.timeout(6000)});if(!r.ok)throw Error("HTTP "+r.status);return r.text();}
 async function run(){try{
  if(!parent.no_html&&!parent.is_bot&&!parent.__partySteamBridge)parent.eval(await download("steam-bridge.js"));
  if(parent.localStorage.getItem("party-code-stopped:"+parent.character.name)==="1"){globalThis.__partyBootstrapPending=false;return;}
  (0,eval)(await download("universal-loader.js"));globalThis.__partyBootstrapPending=false;
 }catch(e){console.warn("Party bootstrap retry",String(e));setTimeout(run,delay);delay=Math.min(delay*2,30000);}}
 void run();
})();`;
  }

  // runtime/steam/realm-choice.ts
  function realmLabel(realm) {
    return realm ? realm.replace(/^SR_/, "").replace(/^(US|EU|ASIA)/, "$1 ") : "unknown";
  }
  function realmMessage(context) {
    if (!context.current) return "Detecting which realm your Adventure Land client is connected to. Login will continue once the realm is confirmed.";
    if (!context.home) return `You're currently on ${realmLabel(context.current)}. Detecting your home realm before continuing login.`;
    if (context.current === context.home) return `You're on your home realm, ${realmLabel(context.current)}. Continuing login\u2026`;
    return `You're currently on ${realmLabel(context.current)}. Your home realm is ${realmLabel(context.home)}. Choose which realm to use before logging in the next character.`;
  }
  function createRealmChoice(document, choose) {
    let dialog = null;
    let signature = "";
    function close() {
      dialog?.remove();
      dialog = null;
      signature = "";
    }
    function show(operation) {
      if (operation?.phase !== "awaiting-realm-choice") {
        close();
        return;
      }
      const next = JSON.stringify([operation.id, operation.realmChoice]);
      if (next === signature) return;
      close();
      signature = next;
      const context = operation.realmChoice || { current: null, home: null };
      dialog = document.createElement("dialog");
      dialog.setAttribute("aria-label", "Choose Steam realm");
      dialog.style.cssText = "background:#151515;color:#fff;border:3px solid #aaa;padding:20px;max-width:480px;font:24px Pixel,monospace";
      const text = document.createElement("p");
      const known = !!context.current && !!context.home;
      text.textContent = realmMessage(context);
      const error = document.createElement("p");
      error.style.color = "#ffcc77";
      const controls = document.createElement("div");
      controls.style.cssText = "display:flex;gap:12px;flex-wrap:wrap";
      let busy = false;
      const submittedDialog = dialog;
      async function submit(choice) {
        if (busy) return;
        busy = true;
        for (const button of controls.querySelectorAll("button")) button.disabled = true;
        try {
          await choose(operation.id, choice);
          if (dialog === submittedDialog) close();
        } catch (failure) {
          error.textContent = String(failure);
        } finally {
          busy = false;
          for (const button of controls.querySelectorAll("button")) button.disabled = false;
        }
      }
      const actions = known && context.current !== context.home ? [
        [`Switch to ${realmLabel(context.home)} realm`, "switch"],
        [`Stay on ${realmLabel(context.current)} realm`, "stay"]
      ] : [];
      actions.push(["Cancel login", "cancel"]);
      for (const [label, choice] of actions) {
        const button = document.createElement("button");
        button.textContent = label;
        button.style.cssText = "background:#242424;color:#fff;border:2px solid #aaa;padding:8px;font:inherit;cursor:pointer";
        button.onmouseenter = () => {
          button.style.backgroundColor = "#484848";
        };
        button.onmouseleave = () => {
          button.style.backgroundColor = "#242424";
        };
        button.onclick = () => {
          void submit(choice);
        };
        controls.append(button);
      }
      dialog.oncancel = (event) => {
        event.preventDefault();
        void submit("cancel");
      };
      dialog.append(text, controls, error);
      document.body.append(dialog);
      dialog.showModal();
    }
    return { show, dispose: close };
  }

  // runtime/steam/recovery.ts
  var stopKey = (name) => "party-code-stopped:" + name;
  function deliberatelyStopped(storage, name) {
    return storage.getItem(stopKey(name)) === "1";
  }
  function runner(game) {
    return game.document.getElementById("maincode")?.contentWindow;
  }
  function occupied(code) {
    const routine = code?.sharedRoutine;
    return routine?.canReload ? !routine.canReload() : !!routine?.isOccupied?.();
  }
  function stale(game, state, now) {
    const code = runner(game);
    const last = Math.max(code?.__partyStatusSuccessAt || 0, code?.__partyLoaderRuntimeStartedAt || state.since);
    return now >= state.next && !occupied(code) && (!game.code_active || now - last >= 2e4);
  }
  function createSteamRecovery(host, bootstrap, persist, log) {
    const states = /* @__PURE__ */ new Map();
    const restores = [];
    const observed = /* @__PURE__ */ new WeakMap();
    let suspended = false, disposed = false, running = false;
    let latest;
    function observe(game) {
      const previous = observed.get(game);
      if (previous && previous.start === game.start_runner && previous.stop === game.stop_runner) return;
      for (const method of ["start_runner", "stop_runner"]) {
        const original = game[method];
        if (!original) continue;
        const wrapped = function(id, code) {
          const name = game.character?.name;
          const event = game.event || host.event;
          const trusted = name && event?.isTrusted && /^(click|keydown|keyup|keypress)$/.test(event.type);
          if (trusted) {
            const stopped = method === "stop_runner";
            host.localStorage.setItem(stopKey(name), stopped ? "1" : "0");
            log(name + (stopped ? ": manual Disengage" : ": manual Engage"));
          }
          const result = original.call(game, id, code);
          if (trusted) void persist(name).catch((error) => log(name + ": autorun persistence failed: " + String(error)));
          return result;
        };
        game[method] = wrapped;
        restores.push(() => {
          if (game[method] === wrapped) game[method] = original;
        });
      }
      observed.set(game, { start: game.start_runner, stop: game.stop_runner });
    }
    const logout = (event) => {
      if (!event.isTrusted) return;
      const target = event.target;
      const action = target?.closest?.("[onclick]")?.getAttribute("onclick") || "";
      if (/socket\.emit\(\s*["']leave["']|\blogout\s*\(/.test(action)) suspended = true;
    };
    host.document.addEventListener("click", logout, true);
    observe(host);
    function gameFor(name) {
      if (name === host.character?.name) return host;
      const frame = host.document.getElementById("ichar" + name.toLowerCase());
      return frame?.contentWindow;
    }
    function allowed(name) {
      if (!latest || disposed || suspended || !host.socket?.connected) return false;
      return owned(name, latest) && !deliberatelyStopped(host.localStorage, name);
    }
    function owned(name, reply) {
      if (reply.primary !== host.character?.name || !reply.steam?.includes(name)) return false;
      const op = reply.operation;
      if (!op || op.phase === "complete") return true;
      return confirmedArrival(name, reply);
    }
    function confirmedArrival(name, reply) {
      const op = reply.operation;
      if (!op.releasedAt || !op.multi || !["navigate", "failed"].includes(op.phase)) return false;
      if (op.multi.primary !== reply.primary || !op.multi.desired.includes(name)) return false;
      const game = gameFor(name);
      return !!op.destinationRealm && !!game && "SR_" + game.server_region + game.server_identifier === op.destinationRealm;
    }
    function observeState(name, game, now) {
      let state = states.get(name);
      if (!state) {
        state = { since: now, next: now + 5e3, attempts: 0, healthy: 0, connected: true };
        states.set(name, state);
      }
      if (!game.socket?.connected) {
        if (state.connected) log(name + ": game connection lost (window present)");
        state.connected = false;
        state.next = now + 5e3;
        return state;
      }
      state.connected = true;
      const code = runner(game);
      const healthy = code?.__partyStatusSuccessAt || 0;
      if (healthy > state.healthy) {
        if (state.attempts) log(name + ": recovery healthy status received");
        state.healthy = healthy;
        state.attempts = 0;
        state.since = now;
      }
      return state;
    }
    async function restart(name, game, state, now) {
      state.attempts++;
      state.next = now + Math.min(3e4, 5e3 * 2 ** Math.min(state.attempts - 1, 3));
      log(name + ": recovery attempt " + state.attempts + (game.code_active ? " (CODE status stale)" : " (unexpected CODE inactivity)"));
      if (state.attempts >= 3) log(name + ": prolonged recovery failure; game window present, healthy CODE status missing");
      try {
        await persist(name);
        if (!allowed(name) || !game.socket?.connected) return;
        game.start_runner?.("maincode", bootstrap);
        await persist(name);
      } catch (error) {
        log(name + ": recovery failed: " + String(error));
      }
    }
    async function recover(reply) {
      for (const name of reply.steam || []) {
        const game = gameFor(name);
        if (!game || game.character?.name !== name) continue;
        observe(game);
        const now = Date.now(), state = observeState(name, game, now);
        if (!allowed(name)) {
          state.next = now + 5e3;
          continue;
        }
        if (state.connected && stale(game, state, now)) await restart(name, game, state, now);
      }
    }
    return { async tick(reply) {
      latest = reply;
      if (running || disposed) return;
      running = true;
      try {
        await recover(reply);
      } finally {
        running = false;
      }
    }, dispose() {
      disposed = true;
      host.document.removeEventListener("click", logout, true);
      for (const restore of restores) restore();
    } };
  }

  // runtime/steam/observations.ts
  function steamObservations(host, stopped, starting, errors) {
    const active = { ...host.get_active_characters?.() };
    for (const name of starting) active[name] ||= "loading";
    for (const name of errors.keys()) active[name] ||= "waiting";
    if (host.character)
      active[host.character.name] = host.socket?.connected ? host.code_active ? "code" : "loading" : "waiting";
    return Object.entries(active).map(([name, value]) => {
      const state = stopped(name) ? "stopped" : value === "code" ? "code" : value === "loading" ? "loading" : "waiting";
      if (state === "code") errors.delete(name);
      return { name, state, primary: name === host.character?.name, error: errors.get(name) };
    });
  }

  // runtime/steam/bridge.ts
  function nativeErrorMessage(error) {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    if (error && typeof error === "object") {
      const fields = error;
      const messages = [fields.reason, fields.error, fields.message].filter((value) => typeof value === "string" && !!value.trim()).map((value) => value.slice(0, 500));
      if (messages.length) return [...new Set(messages)].join(": ");
    }
    return "Native Steam operation failed without an error reason";
  }
  var slotKey = "party-console-bootstrap-slot-v1";
  var operationKey = "party-console-steam-operation-v1";
  var releaseKey = "party-console-steam-release-v1";
  function restoreRelease(storage) {
    try {
      const value = JSON.parse(storage.getItem(releaseKey) || "null");
      if (value?.released === true && typeof value.operationId === "string" && (value.from === null || typeof value.from === "string"))
        return value;
    } catch {
    }
    return null;
  }
  function installSteamBridge(host) {
    const server = serverAddress(host);
    const API = server + "/party-api";
    const bootstrap = steamBootstrap(server);
    if (host.caracAL || host.no_html || host.is_bot) return;
    host.__partySteamBridge?.dispose();
    const lifecycle = new AbortController();
    let timer;
    let released = restoreRelease(host.sessionStorage);
    let releasing = released?.operationId || null;
    let navigating = null;
    let failure = null;
    const clientId = host.sessionStorage.getItem("party-steam-client") || crypto.randomUUID();
    host.sessionStorage.setItem("party-steam-client", clientId);
    const sessionId = host.__partySteamSessionId ||= crypto.randomUUID();
    const switcher = createSwitcher(host, (character, action = "primary") => post("/steam/action", { character, action }));
    const realmChoice = createRealmChoice(host.document, (operationId, choice) => post("/steam/realm-choice", { operationId, choice }));
    const starting = /* @__PURE__ */ new Set();
    const startErrors = /* @__PURE__ */ new Map();
    let rosterRefreshPending = null;
    let lastRosterRefreshAt = 0;
    async function refreshRejectedRoster(error) {
      const reason = typeof error === "string" ? error : error && typeof error === "object" && "reason" in error ? error.reason : null;
      if (reason !== "already_running" || lifecycle.signal.aborted) return;
      if (rosterRefreshPending) return rosterRefreshPending;
      if (Date.now() - lastRosterRefreshAt < 3e3) return;
      lastRosterRefreshAt = Date.now();
      rosterRefreshPending = Promise.resolve().then(async () => {
        if (lifecycle.signal.aborted) return;
        await host.api_call("servers_and_characters", {});
        if (lifecycle.signal.aborted) return;
      }).catch((refreshError) => {
        if (!lifecycle.signal.aborted)
          console.warn("[Steam bridge] Refreshing account roster: " + nativeErrorMessage(refreshError));
      }).finally(() => {
        rosterRefreshPending = null;
      });
      return rosterRefreshPending;
    }
    let missingSince = 0;
    const recovery = createSteamRecovery(
      host,
      bootstrap,
      ensureBootstrap,
      (message) => {
        console.warn("[Steam recovery] " + message);
        host.add_log?.(message, "#ffcc77");
      }
    );
    let bootstrapSaved = false;
    async function post(path, body) {
      const response = await host.fetch(API + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.any([lifecycle.signal, AbortSignal.timeout(1e4)])
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Steam bridge request failed");
      return payload;
    }
    async function ensureBootstrap(target) {
      const connectionSlotKey = slotKey + ":" + server;
      let slot = host.localStorage.getItem(connectionSlotKey);
      const excluded = /* @__PURE__ */ new Set();
      if (!slot || !/^(?:[1-9]|[1-9][0-9]|100)$/.test(slot)) slot = null;
      if (slot && !bootstrapSaved) {
        const response = await host.fetch("/code.js?name=" + encodeURIComponent(slot), {
          cache: "no-store",
          signal: AbortSignal.any([lifecycle.signal, AbortSignal.timeout(6e3)])
        });
        if (!response.ok) throw new Error("Cannot verify managed bootstrap slot");
        const code = (await response.text()).trim();
        const legacy = `globalThis.__partyServer=${JSON.stringify(server)};parent.__partyServer=globalThis.__partyServer;$.getScript(${JSON.stringify(server + "/CODE/adventure_land/universal-loader.js")});`;
        if (code !== bootstrap && code !== legacy && code !== previousSteamBootstrap(server)) {
          excluded.add(slot);
          slot = null;
        }
      }
      if (!slot) {
        const codes = host.X?.codes;
        if (!codes || typeof codes !== "object" || Array.isArray(codes))
          throw new Error("Cannot inspect saved CODE slots. Refresh the Adventure Land account selection and retry.");
        for (let candidate = 100; candidate >= 1; candidate--) {
          const key = String(candidate);
          if (!Object.hasOwn(codes, key) && !excluded.has(key)) {
            slot = key;
            break;
          }
        }
        if (!slot) throw new Error("No free Adventure Land CODE slot (1\u2013100). Free a saved slot and retry; existing CODE has not been overwritten.");
      }
      if (!bootstrapSaved) {
        const saved = await host.api_call("save_code", {
          slot,
          name: "PartyConsole",
          code: bootstrap,
          electron: true,
          auto: true
        });
        if (saved.failed || saved.success !== true)
          throw new Error(saved.reason || "Could not save the generic CODE bootstrap");
        host.localStorage.setItem(connectionSlotKey, slot);
        bootstrapSaved = true;
      }
      const character = host.X?.characters.find((entry) => entry.name === target);
      if (!character) throw new Error("Steam account roster does not contain " + target);
      const raw = host.storage_get("code_cache") || "{}";
      if (!host.localStorage.getItem(connectionSlotKey + ":original-cache"))
        host.localStorage.setItem(connectionSlotKey + ":original-cache", raw);
      const cache = JSON.parse(raw);
      cache["slot_" + character.id] = slot;
      cache["run_" + character.id] = "1";
      cache["code_" + character.id] = bootstrap;
      host.storage_set("code_cache", JSON.stringify(cache));
      return slot;
    }
    function persistRelease(operation) {
      releasing = operation.id;
      released = { operationId: operation.id, from: operation.from, released: true };
      host.sessionStorage.setItem(releaseKey, JSON.stringify(released));
    }
    function disconnectPrimary() {
      host.auto_reload = "off";
      host.character_to_load = null;
      host.reload_state = false;
      host.stop_runner();
      host.socket?.disconnect();
    }
    async function releaseNative(operation) {
      releasing = operation.id;
      if (operation.target) await ensureBootstrap(operation.target);
      if (lifecycle.signal.aborted) return;
      host.localStorage.setItem(operationKey, operation.id);
      persistRelease(operation);
      disconnectPrimary();
    }
    function navigate(id, target, destinationRealm) {
      navigating = id;
      const realm = destinationRealm.replace(/^SR_/, "").match(/^(US|EU|ASIA)(I|II|III|IV|V|PVP)$/);
      if (!realm) throw new Error("Invalid Steam destination realm");
      host.location.href = "/character/" + encodeURIComponent(target) + "/in/" + realm[1] + "/" + realm[2] + "/";
    }
    function mayStartCompanion(operation, name) {
      const group = operation.multi;
      if (!operation.destinationRealm || !group.before || group.before.includes(name)) return true;
      return group.before.filter((member) => group.desired.includes(member)).every((member) => (group.arrived || []).includes(member));
    }
    async function act(reply) {
      const operation = reply.operation;
      realmChoice.show(operation);
      await recovery.tick(reply);
      if (lifecycle.signal.aborted) return;
      if (operation?.phase === "awaiting-realm-choice") return;
      if ((!operation || operation.phase === "complete") && reply.primary === host.character?.name && host.socket?.connected) {
        for (const name of reply.steam || []) await ensureBootstrap(name);
        const active = host.get_active_characters?.() || {};
        const missing = (reply.steam || []).some((name) => name !== reply.primary && !active[name] && !deliberatelyStopped(host.localStorage, name));
        if (!missing) missingSince = 0;
        else if (!missingSince) missingSince = Date.now();
        else if (Date.now() - missingSince >= 8e3) {
          missingSince = Date.now();
          await post("/steam/restore", {});
          return;
        }
      }
      if (operation?.multi) {
        const group = operation.multi;
        const retryRelease = operation.phase === "failed" && group.action === "headless" && group.releaseIssued && !operation.releasedAt && host.socket?.connected && group.release.includes(host.character?.name || "") && [
          "Steam operation timed out; assignments remain reserved until recovery",
          "Coordinator restarted during handoff; confirm offline ownership before recovery"
        ].includes(operation.error || "");
        if (operation.phase === "failed" && !retryRelease) {
          releasing = null;
          failure = null;
          return;
        }
        if (operation.phase === "complete") return;
        if (operation.phase === "release" && releasing !== operation.id || retryRelease) {
          for (const name of group.desired) await ensureBootstrap(name);
          if (lifecycle.signal.aborted) return;
          host.localStorage.setItem(operationKey, operation.id);
          persistRelease(operation);
          for (const name of group.release) {
            if (name === host.character?.name) disconnectPrimary();
            else host.stop_character_runner?.(name);
          }
        }
        if (operation.phase === "navigate" && group.primary) {
          const destination = operation.destinationRealm || reply.realm;
          const wrongRealm = operation.destinationRealm && "SR_" + host.server_region + host.server_identifier !== destination;
          if (host.character?.name !== group.primary || !host.socket?.connected || wrongRealm) {
            if (navigating !== operation.id) navigate(operation.id, group.primary, destination);
            return;
          }
          const active = host.get_active_characters?.() || {};
          for (const name of group.desired) {
            if (name === group.primary || active[name] || starting.has(name)) continue;
            if (!mayStartCompanion(operation, name)) continue;
            if (!host.start_character_runner) throw new Error("This Steam client cannot start background characters");
            const slot = await ensureBootstrap(name);
            starting.add(name);
            void Promise.resolve(host.start_character_runner(name, slot)).catch(async (error) => {
              if (lifecycle.signal.aborted) return;
              startErrors.set(name, nativeErrorMessage(error));
              console.warn("[Steam bridge] Starting " + name + ": " + nativeErrorMessage(error));
              await refreshRejectedRoster(error);
            }).finally(() => {
              if (!lifecycle.signal.aborted) host.setTimeout(() => {
                if (!lifecycle.signal.aborted) starting.delete(name);
              }, 3e3);
            });
          }
        }
        return;
      }
      if (!operation || operation.phase === "failed" || operation.phase === "complete") return;
      if (operation.phase === "release" && releasing !== operation.id) {
        await releaseNative(operation);
      }
      if (operation.phase === "navigate" && operation.target && navigating !== operation.id) {
        navigate(operation.id, operation.target, reply.realm);
      }
    }
    function clearCompleted(reply) {
      if (!reply.operation || reply.operation.phase === "complete") {
        released = null;
        failure = null;
        releasing = null;
        navigating = null;
        host.localStorage.removeItem(operationKey);
        host.sessionStorage.removeItem(releaseKey);
      }
    }
    async function poll() {
      if (lifecycle.signal.aborted) return;
      let reply;
      try {
        reply = await post("/steam/bridge", {
          version: 2,
          clientId,
          sessionId,
          character: host.socket?.connected ? host.character?.name : null,
          realm: host.socket?.connected ? "SR_" + host.server_region + host.server_identifier : null,
          observations: steamObservations(host, (name) => deliberatelyStopped(host.localStorage, name), starting, startErrors),
          running: [
            ...host.socket?.connected && host.character && host.code_active ? [host.character.name] : [],
            ...Object.entries(host.get_active_characters?.() || {}).filter(([, state]) => state === "code").map(([name]) => name)
          ],
          operationId: host.localStorage.getItem(operationKey),
          ...released,
          ...failure
        });
        if (lifecycle.signal.aborted) return;
        clearCompleted(reply);
        switcher.render(reply);
        await act(reply);
      } catch (error) {
        const message = nativeErrorMessage(error);
        console.warn("[Steam bridge] " + message);
        if (reply?.operation) failure = { operationId: reply.operation.id, error: message };
      } finally {
        if (!lifecycle.signal.aborted)
          timer = host.setTimeout(() => void poll(), 1e3);
      }
    }
    host.__partySteamBridge = {
      realmProtocol: 2,
      version: steamBridgeVersion,
      server,
      dispose() {
        lifecycle.abort();
        host.clearTimeout(timer);
        switcher.dispose();
        realmChoice.dispose();
        recovery.dispose();
      }
    };
    void poll();
  }

  // runtime/steam/entry.ts
  installSteamBridge(globalThis);
})();

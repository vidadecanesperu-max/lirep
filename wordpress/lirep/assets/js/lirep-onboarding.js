/* LIREP 1.7.0 — Admin-only activation UX. All feedback in accessible modal. */
(() => {
  "use strict";
  const config = window.LIREP_SETUP;
  if (!config) return;
  const dialog = document.getElementById("lirep-dialog");
  const message = document.getElementById("lirep-dialog-message");
  const close = document.getElementById("lirep-dialog-close");
  const progress = document.getElementById("lirep-progress");
  let lastFocus = null;
  function modal(text) {
    if (!dialog) return;
    lastFocus = document.activeElement;
    message.textContent = text;
    dialog.hidden = false;
    close.focus();
  }
  function dismiss() {
    dialog.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  close?.addEventListener("click", dismiss);
  dialog?.addEventListener("click", (event) => {
    if (event.target === dialog) dismiss();
  });
  document.addEventListener("keydown", (event) => {
    if (!dialog?.hidden && event.key === "Escape") dismiss();
    if (!dialog?.hidden && event.key === "Tab") {
      // The modal has one actionable control: keep keyboard focus inside it.
      event.preventDefault();
      close.focus();
    }
  });
  async function run(operation, data = {}) {
    const params = new URLSearchParams({ action: "lirep_onboarding", operation, nonce: config.nonce });
    for (const [key, value] of Object.entries(data)) params.set(key, value);
    const response = await fetch(config.ajax, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: params.toString(),
    });
    const body = await response.json();
    if (!response.ok || !body.success) throw new Error(body?.data?.message || "No se pudo completar la operación.");
    return body.data;
  }
  function busy(button, state) {
    if (!button) return;
    button.disabled = state;
    button.setAttribute("aria-busy", String(state));
  }
  const form = document.getElementById("lirep-start-form");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]');
    busy(button, true);
    try {
      const data = Object.fromEntries(new FormData(form).entries());
      const result = await run("start", data);
      modal(result.message || "Solicitud recibida.");
      close.onclick = () => { dismiss(); window.location.reload(); };
    } catch (error) { modal(error.message); }
    finally { busy(button, false); }
  });
  const status = document.getElementById("lirep-status");
  status?.addEventListener("click", async () => {
    busy(status, true);
    try {
      const data = await run("status");
      const parts = [
        data.email_verified ? "Correo verificado" : "Correo pendiente",
        data.domain_verified ? "Dominio verificado" : "Dominio pendiente",
        data.invitation_sent ? "Acceso administrativo enviado" : "Acceso pendiente",
      ];
      if (progress) progress.textContent = parts.join(" · ");
      if (data.state === "active" && data.invitation_sent) {
        modal("Empresa activada. Identificador: " + data.public_prefix + ". Ya puedes insertar [lirep].");
        close.onclick = () => { dismiss(); window.location.reload(); };
      } else {
        modal(parts.join(". ") + ".");
      }
    } catch (error) { modal(error.message); }
    finally { busy(status, false); }
  });
  const verify = document.getElementById("lirep-verify");
  verify?.addEventListener("click", async () => {
    busy(verify, true);
    try {
      const data = await run("verify-domain");
      if (data.notice === "EMAIL_SENT") {
        modal("Dominio verificado. Enviamos un enlace al correo indicado. Verifícalo y vuelve a pulsar «Verificar dominio y continuar» para completar la activación.");
      } else if (data.state === "active" && data.invitation_sent) {
        modal("¡LIREP activado! Se envió el acceso administrativo al correo verificado.");
        close.onclick = () => { dismiss(); window.location.reload(); };
      } else modal("Dominio verificado. Revisa el estado de la activación.");
    } catch (error) { modal(error.message); }
    finally { busy(verify, false); }
  });
  const cancel = document.getElementById("lirep-cancel");
  cancel?.addEventListener("click", async () => {
    busy(cancel, true);
    try {
      const result = await run("cancel");
      modal(result.message);
      close.onclick = () => { dismiss(); window.location.reload(); };
    } catch (error) { modal(error.message); }
    finally { busy(cancel, false); }
  });
})();

(function () {
  var configUrl = window.SEROGULD_GDPR_BRIDGE_CONFIG_URL;
  var mountSelector = window.SEROGULD_GDPR_BRIDGE_SELECTOR || ".seroguld-gdpr-bridge";

  if (!configUrl) {
    console.warn("[SeroGuld GDPR] SEROGULD_GDPR_BRIDGE_CONFIG_URL tanımlı değil.");
    return;
  }

  function renderLinks(config) {
    return (
      '<ul class="seroguld-gdpr-links">' +
      '<li><a href="' + config.privacy_policy_url + '">Privatlivspolitik</a></li>' +
      '<li><a href="' + config.cookies_url + '">Cookies</a></li>' +
      '<li><a href="' + config.privacy_request_url + '">Anmod om dataindsigt</a></li>' +
      "</ul>"
    );
  }

  function ensureMount() {
    var mount = document.querySelector(mountSelector);
    if (mount) return mount;

    mount = document.createElement("div");
    mount.className = mountSelector.replace(/^[.#]/, "");

    if (document.currentScript && document.currentScript.parentNode) {
      document.currentScript.parentNode.insertBefore(mount, document.currentScript);
    } else {
      document.body.appendChild(mount);
    }

    return mount;
  }

  fetch(configUrl, { credentials: "omit" })
    .then(function (response) {
      if (!response.ok) {
        throw new Error("bridge-config fetch failed: " + response.status);
      }
      return response.json();
    })
    .then(function (config) {
      var mount = ensureMount();
      mount.innerHTML = renderLinks(config);
    })
    .catch(function (error) {
      console.warn("[SeroGuld GDPR] Bridge snippet yüklenemedi.", error);
    });
})();

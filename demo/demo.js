import { CompanionClient } from '/client/index.js';

const $ = (id) => document.getElementById(id);
const remote = location.protocol === 'https:';
const client = new CompanionClient(location.origin, { transport: remote ? 'remote-https' : 'loopback' });
if (remote) {
  document.querySelector('.local-label').textContent = 'PERSONAL SERVER';
  document.querySelector('.intro .eyebrow').textContent = 'YOUR SERVER · YOUR SESSION';
  $('connectionNote').textContent = 'Pairing authorizes this browser to use your personal server. It is separate from signing in to Codex.';
  document.title = 'Codex Local Companion · Personal server';
}
let session = null;
let activeController = null;
let availableModels = [];
let accountStatus = null;

function showError(message) { $('connectionError').textContent = message; $('connectionError').hidden = false; }
function clearError() { $('connectionError').textContent = ''; $('connectionError').hidden = true; }
function setConnected(value) {
  $('pairingView').hidden = value; $('connectedView').hidden = !value;
  $('connectionState').textContent = value ? 'Connected' : 'Not connected';
  $('connectionState').className = `badge ${value ? 'online' : 'offline'}`;
  $('loginButton').disabled = !value;
  $('refreshButton').disabled = !value;
  $('logoutButton').disabled = !value;
  $('prompt').disabled = !value; $('modelSelect').disabled = !value; $('effortSelect').disabled = !value;
  $('generateButton').disabled = !value;
}
function announce(text, error = false) { $('generationMessage').textContent = text; $('generationMessage').className = `message${error ? ' error' : ''}`; $('generationMessage').hidden = !text; }

async function refreshStatus() {
  const status = await client.status();
  accountStatus = status;
  $('generateButton').disabled = !session || !status.authenticated || !status.inferenceEnabled;
  if (status.authenticated) { $('userCode').textContent = ''; $('loginDetails').hidden = true; }
  $('loginButton').disabled = !session?.accountAdmin || status.authenticated;
  $('logoutButton').disabled = !session?.accountAdmin || !status.authenticated;
  $('accountState').textContent = status.authenticated ? 'Signed in' : 'Signed out';
  $('accountState').className = `badge ${status.authenticated ? 'online' : 'offline'}`;
  $('accountSummary').textContent = status.authenticated
    ? `${status.authMode || 'Codex'}${status.planType ? ` · ${status.planType}` : ''} · Runtime ${status.runtimeVersion}`
    : `No Codex account session · Runtime ${status.runtimeVersion}`;
  return status;
}

function updateEfforts() {
  const model = availableModels.find((item) => item.model === $('modelSelect').value);
  const select = $('effortSelect'); select.replaceChildren();
  for (const item of model?.supportedReasoningEfforts ?? []) {
    const option = document.createElement('option'); option.value = item.reasoningEffort;
    option.textContent = item.description ? `${item.reasoningEffort} — ${item.description}` : item.reasoningEffort;
    select.append(option);
  }
  if (model) select.value = model.defaultReasoningEffort;
  select.disabled = !model;
}

async function loadModels() {
  availableModels = await client.models();
  const select = $('modelSelect'); select.replaceChildren();
  for (const item of availableModels) {
    const option = document.createElement('option'); option.value = item.model; option.textContent = item.displayName || item.model;
    select.append(option);
  }
  if (availableModels.length) { select.value = availableModels[0].model; updateEfforts(); }
}

$('pairButton').addEventListener('click', async () => {
  clearError(); $('pairButton').disabled = true;
  try {
    const paired = await client.pair($('pairCode').value.trim());
    $('pairCode').value = '';
    session = paired.session; $('sessionName').textContent = session.name;
    $('sessionMeta').textContent = `${session.origin} · Expires ${new Date(session.expiresAt).toLocaleString()}`;
    setConnected(true); await Promise.all([refreshStatus(), loadModels()]);
  } catch (error) { showError(`Could not pair: ${error.code || 'connection_error'}`); }
  finally { $('pairButton').disabled = false; }
});

$('modelSelect').addEventListener('change', updateEfforts);
$('refreshButton').addEventListener('click', () => refreshStatus().catch(error => showError(error.code || 'connection_error')));
$('logoutButton').addEventListener('click', async () => {
  try { activeController?.abort(); await client.logout(); await refreshStatus(); }
  catch (error) { showError(error.code || 'signout_failed'); }
});
$('disconnectButton').addEventListener('click', async () => {
  clearError(); $('disconnectButton').disabled = true;
  activeController?.abort();
  try { await client.disconnect(); }
  catch (error) { showError(`Disconnect failed: ${error.code || 'connection_error'}`); }
  finally {
    $('pairCode').value = ''; $('userCode').textContent = ''; $('loginDetails').hidden = true;
    session = null; accountStatus = null; availableModels = []; setConnected(false); $('disconnectButton').disabled = false;
  }
});

$('loginButton').addEventListener('click', async () => {
  clearError(); $('loginButton').disabled = true;
  try {
    const login = await client.login();
    $('verificationLink').href = login.verificationUrl; $('verificationLink').textContent = login.verificationUrl;
    $('userCode').textContent = login.userCode; $('loginDetails').hidden = false;
  } catch (error) { showError(`Sign-in could not start: ${error.code || 'request_failed'}`); }
  finally { $('loginButton').disabled = false; }
});

$('generateButton').addEventListener('click', async () => {
  $('resultCard').hidden = true; announce('Working…');
  activeController = new AbortController(); $('cancelButton').hidden = false; $('generateButton').disabled = true;
  try {
    const result = await client.generate({
      instructions: $('prompt').value,
      messages: [{ role: 'user', content: $('prompt').value }],
      model: $('modelSelect').value, effort: $('effortSelect').value,
      outputSchema: { type: 'object', properties: { draft: { type: 'string' } }, required: ['draft'], additionalProperties: false },
      signal: activeController.signal,
    });
    if (result.state === 'completed') {
      const value = result.result?.data && typeof result.result.data === 'object' && 'draft' in result.result.data
        ? result.result.data.draft : result.result?.text;
      $('resultText').textContent = typeof value === 'string' ? value : JSON.stringify(value ?? '', null, 2);
      $('resultCard').hidden = false; announce('Draft ready.');
    } else if (result.state === 'failed') announce(`Generation failed: ${result.error?.code || 'unknown_error'}`, true);
    else announce(`Generation ${result.state}.`);
  } catch (error) {
    if (error.name === 'AbortError') announce('Generation cancelled.');
    else announce(`Generation failed: ${error.code || 'connection_error'}`, true);
  } finally { activeController = null; $('cancelButton').hidden = true; $('generateButton').disabled = !session || !accountStatus?.authenticated || !accountStatus?.inferenceEnabled; }
});
$('cancelButton').addEventListener('click', () => activeController?.abort());

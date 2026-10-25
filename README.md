# ProcureLink · OPO Command Center

A dark React dashboard for Western Ohio OPO referrals, staff matching, and a continuous outcome feedback demo. Built with Vite, TypeScript, Tailwind CSS, Lucide, and deck.gl.

## Run

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. For a production build:

```sh
npm run build
npm run preview
```

## Demo flow

1. Select **New referral**, enter clinical details and family context, and create the referral.
2. Compare staff estimates in the case detail view. Select **Assign OPO Staff**. Busy staff cannot be double-booked. Assignment updates the map route immediately.
3. Select **Log case outcome**, choose **Not authorized**, and submit. The confirmation shows that staff member’s estimate decreasing for similar cases.
4. Select **Try a similar case**. The new referral copies the original clinical and family context, with no staff or outcome assigned.
5. Assign a different staff member and log an **Authorized** outcome. Their estimate increases for similar cases.
6. Review both changes in **Training Data Loop**. Reloading the page preserves cases, assignments, and outcomes in local storage.

The five navigation views are functional. The case table supports search, hospital and emotional-state filtering, date ranges, status tabs, sorting, pagination, and CSV export. Case and outcome exports include the requested input schema. Staff Analytics shows availability, experience, and historical outcomes. Case forms include additional clinical fields and all family-context flags.

## Matching model

When FastAPI is unavailable, `src/lib/model.ts` provides a local similarity-weighted Beta-Bernoulli demo estimator with fictional historical records. When FastAPI is online, rankings come from the CSV-trained OPC-specific XGBoost models instead.

- Authorization failure lowers the assigned staff member’s estimate.
- Authorization success raises the assigned staff member’s estimate.
- Other staff members’ estimates are unaffected by that individual outcome.
- An outcome is recorded once per case; completing a case releases its staff assignment.
- Age, gender, and race are recorded for display/export and excluded from prediction.
- Estimates are illustrative and are not validated clinical predictions or staff-performance assessments.

The dashboard discovers FastAPI at `/api/health` on startup. When the API is online, the case matcher requests per-OPC predictions from the CSV-trained XGBoost models. Finalizing an assigned case submits its ID, clinical/family fields, authorization, consent, and notes to that OPC model before the website marks it complete. The Vite development server proxies `/api` to `http://127.0.0.1:8000`. When the API is unavailable, the dashboard indicates that it has switched to its browser demo model. Case records and assignments remain in browser local storage; XGBoost updates are held in API memory until the service restarts.

## Run the connected site

Start FastAPI and Vite in separate terminals:

```sh
.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1
npm run dev
```

Open the Vite URL, normally `http://localhost:5173`. The badge shows **CSV MODEL CONNECTED** when all 15 matching OPC models are online. You can make a new referral as usual, see its live rankings, assign an OPC, and log the outcome to train the corresponding model.

Set `VITE_API_PROXY_TARGET` if FastAPI listens elsewhere. For a separately hosted API, set `VITE_API_BASE_URL` to its origin and allow the website's origin with `OPC_API_ALLOW_ORIGINS`. See [.env.example](.env.example). The OPC identifiers map to fictional demo names and portraits; replace those profiles with the actual roster before operational use.

### Case briefs through AI4Free

FastAPI runs AI4Free's Groq provider in the separate Python 3.11 environment `.venv-ai4free`. XGBoost stays in the main `.venv`. The worker loads only AI4Free's Groq module, avoiding its broken imports of unrelated browser providers, and uses its Requests transport rather than urllib. Groq still requires `GROQ_API_KEY`.

To recreate the AI4Free environment:

```sh
python3.11 -m venv .venv-ai4free
.venv-ai4free/bin/python -m pip install -r requirements-ai4free.txt
```

Put these values in the project-root `.env` (copy `.env.example`), then restart FastAPI:

```dotenv
GROQ_API_KEY=your-groq-key
GROQ_MODEL=openai/gpt-oss-20b
```

Shell exports take precedence over `.env`. Set `AI4FREE_PYTHON` to an absolute interpreter path if the isolated environment lives elsewhere. Credentials are inherited by the worker through its environment, never passed through command arguments or sent to the browser.

Open `http://localhost:8000/groq/status` to check the same worker, key, and transport used for brief generation. This calls Groq's model metadata endpoint; it verifies authentication and metadata access, while inference can still have separate permissions or limits. A non-JSON 403 can come from a gateway and does not establish that a model is blocked. Provider errors are shown with credentials redacted.

Case details generate a brief and short explanation of the selected XGBoost match on demand. An unavailable provider returns a visibly labeled `local_fallback`; it does not change predictions. The UI labels successful responses as AI4Free · Groq. This integration is for the app's fictional records.

## Python XGBoost API

`main.py` trains one binary XGBoost booster per `opc_id` from the expanded dataset. Start the API with one worker:

```sh
python -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/uvicorn main:app --reload
```

Open `http://localhost:8000/docs` for interactive request schemas and examples. Dataset paths are resolved relative to `main.py`, so starting the server from another directory does not change which dataset is loaded.

| Endpoint | Behavior |
| --- | --- |
| `GET /output?row_num=-4` | Return all OPCs ranked by authorization probability for a dataset row. Negative row indices are supported. |
| `POST /output` | Accept the 18 case feature fields and return ranked probabilities without training. |
| `POST /cases/brief` | Generate a brief and match rationale for one OPC from a case and its model contributions. |
| `POST /opcs/{opc_id}/cases` | Accept the same fields plus `authorized` and optional `case_id`, `consent_obtained`, and `notes`; append the completed case to this OPC's history and continue its existing booster by five rounds. |
| `DELETE /opcs/{opc_id}/cases/{case_id}` | Remove a submitted outcome and rebuild that OPC model from its original CSV rows and remaining submitted cases. |

Use an existing dataset ID such as `OPC_01` in the training endpoint; an unknown OPC returns 404. Missing or invalid fields return 422. `opc_id` belongs in the URL, and `authorized` is only sent when training. `registry_status` is a string matching the dataset, such as `Not Registered` or `First Person Consent / Registered`; dataset genders use `M` and `F`. The training route appends completed cases to the running service's in-memory history; persist that history externally if it must survive service restarts.

Example completed-case payload (`case.json`):

```json
{
  "age": 45,
  "gender": "M",
  "race": "White",
  "brain_death": true,
  "cause_of_death_unos": "Anoxia",
  "mechanism_of_death": "Cardiovascular",
  "circumstances_of_death": "Natural causes",
  "registry_status": "Not Registered",
  "primary_etiology": "Anoxic brain injury",
  "donation_pathway": "DBD",
  "premature_donation_mention": false,
  "multiple_decision_makers": false,
  "family_estrangement": false,
  "medical_mistrust": false,
  "interpreter_utilized": false,
  "patient_hemodynamically_unstable": false,
  "late_referral_rushing_withdrawal": false,
  "family_emotional_state": "Shutdown/Stoic",
  "authorized": true
}
```

```sh
curl -X POST http://localhost:8000/opcs/OPC_01/cases \
  -H 'Content-Type: application/json' --data-binary @case.json
curl 'http://localhost:8000/output?row_num=-1'
```

The training response includes the appended `case_index`, total training cases for that OPC, total boosting rounds, and probabilities before and after the update. It also accepts and stores the optional case ID, consent result, and staff notes. That row can immediately be used with `GET /output`. `/health` reports per-OPC aggregate model counts and rates without returning patient rows. The Python functions are also callable directly:

```python
from main import add_case, output

result = add_case("OPC_01", completed_case_dict)
ranked = output(result["case_index"])
# For an uncompleted case, pass only feature fields:
ranked = output(case=case_features_dict)
```

Updates use XGBoost's `xgb_model` continuation parameter and replay all accumulated cases belonging to that OPC. Other OPC models are unchanged. The fitted encoder is reused; unseen categorical values are encoded as all zeros for that feature. Training on history means a single outcome is not guaranteed to move its probability in a particular direction. All new cases and booster updates are in memory and reset on process restart or development reload. Use a single server worker; multiple workers would maintain independent registries. Each accepted training request adds a case, so repeated requests add repeated observations.

Run the Python API/model tests with:

```sh
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest tests/test_api.py
```

## Map and portraits

The map uses deck.gl `ScatterplotLayer`, `TextLayer`, and `LineLayer` over a synchronized MapLibre basemap with OpenFreeMap vector tiles. OpenFreeMap requires no API key; OpenFreeMap, OpenMapTiles, and OpenStreetMap attribution is included. Hospital markers and the facility controls both open case popovers. Assignments connect staff coordinates to hospital coordinates. ETA is a rough estimate using haversine distance at 65 km/h; it does not use roads or traffic.

Map rendering requires WebGL, and basemap tiles require internet access. Hospital controls remain accessible if graphics or tiles fail. Generated portraits were downloaded from `https://thispersondoesnotexist.com/random-person.jpeg`, randomly associated with fictional staff profiles, and resized to local 160×160 assets. Names and portrait demographics are unrelated. Google Fonts are used when available, with system font fallbacks.

## Verify

```sh
npm test
npm exec playwright -- install chromium
npm run test:e2e
```

Model tests cover feedback direction, independent staff updates, duplicate protection, assignment requirements, consent consistency, demographic exclusion, and geographic distance. Browser tests cover searching, filtering, CSV export, hospital selection, mobile navigation, case creation, assignment, unsuccessful/successful outcomes, and persistence. Browser tests use a local Vite server automatically.

In environments using a temporary browser installation, run:

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/relay-playwright npm run test:e2e
```

The production map bundles are loaded separately and are comparatively large because deck.gl and MapLibre include their WebGL rendering engines.

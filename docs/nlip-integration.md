# NLIP agent communication

Illinois Chat projects can ask registered remote agents and answer incoming
project-document questions using the [NLIP](https://nlip-project.org/) HTTP JSON
text profile. Configuration and exchanges appear in the existing project Tools
and Chat pages. There is no separate demo page or new package dependency.

## Existing architecture and extension points

Uploading documents creates a project-scoped retrieval knowledge base; it does
not train a model. Ingestion parses files, creates chunks and embeddings, and
stores them in the configured vector database. Chat retrieves relevant chunks
and includes them in the selected model's prompt. Each project also has its own
system prompt, provider settings, access controls, and tools.

Paths below are relative to the repository root; `src/` paths refer to
`apps/frontend/src/`.

| Responsibility | Existing implementation | NLIP extension |
| --- | --- | --- |
| Project creation and uploads | `src/pages/new.tsx`, `src/components/UIUC-Components/MakeNewCoursePageSteps/`, `LargeDropzone.tsx` | Use the existing project and upload flow |
| Document processing and retrieval | `apps/backend/ai_ta_backend/rabbitmq/`, `service/retrieval_service.py`, `src/utils/fetchContexts.ts` | Reuse project retrieval for incoming questions |
| Agent planning, tool execution, and evidence | `src/server/agent/runAgentConversation.ts`, `agentServerUtils.ts` | Register `ask_nlip_<id>` tools and dispatch them by `nlip:` ID |
| Ordinary-chat tools | `src/utils/functionCalling/handleFunctionCalling.ts` | Discover NLIP tools alongside Sim workflows and execute them through the authenticated API |
| Prompt and model routing | `src/app/utils/buildPromptUtils.ts`, `src/server/determineAndValidateModelServer.ts`, `src/utils/streamProcessing.ts` | Reuse these in `src/server/nlip/answerProject.ts` |
| Project Tools configuration | `src/components/UIUC-Components/SimPage.tsx` | Compose `NlipAgentsPanel.tsx`; query/save through `src/hooks/queries/useNlipConfig.ts` |
| Chat tool activity | `src/components/Chat/AgentExecutionTimeline.tsx`, `ChatMessage.tsx` | Share `NlipConversation.tsx` to render questions, replies, waiting, and failures |
| Configuration and credentials | Redis metadata store and `src/utils/crypto.ts` | `src/server/nlip/config.ts` stores project settings and uses existing encryption |
| Protocol and HTTP transport | Existing `UIUCTool` and `ToolOutput` types | Shared `src/types/nlip.ts` schemas and `src/server/nlip/client.ts` adapter |

Agent orchestration runs in the Next.js server. The Flask backend remains
responsible for document processing and retrieval. NLIP adds no database
migration, alternative model provider, or separate application.

Incoming requests use a leaf RAG adapter: retrieve the target project's documents,
build a prompt, and call its configured server-side model. They do not discover
or call other agents. This avoids reciprocal delegation. Outgoing delegation
uses the existing Agent Mode loop and its step limits. Only the generated
question is sent to a remote agent; uploaded files and conversation history are
not automatically forwarded.

## APIs and protocol scope

| Method and path | Behavior | Required access |
| --- | --- | --- |
| `POST /api/nlip/<project>` | Answer a document question as an NLIP message | Active Illinois Chat API key belonging to a project owner/admin; inbound access enabled |
| `GET /api/UIUC-api/tools/nlipAgents?course_name=X` | Read configuration; credentials represented only by `hasToken` | Authenticated project owner/admin |
| `POST /api/UIUC-api/tools/nlipAgents?course_name=X` | Save inbound settings and remote agents | Authenticated project owner/admin |
| `GET /api/UIUC-api/tools/nlipTools?course_name=X` | Discover enabled remote-agent tools | Authenticated user with project access |
| `POST /api/UIUC-api/tools/nlipTools?course_name=X` | Execute `{ "id": "lab", "question": "..." }` | Authenticated user with project access |

Frozen projects reject these operations. Browser requests use the existing
`withAuth` middleware. Incoming agent requests reuse Illinois Chat API keys;
HTTP Bearer authorization and NLIP `authorization` token submessages are
supported. Conflicting credentials are rejected.

Example request:

```json
{
  "format": "text",
  "subformat": "english",
  "content": "When and where is lab orientation?",
  "submessages": [
    { "format": "token", "subformat": "conversation", "content": "turn-1" }
  ]
}
```

An answer contains text, the matching conversation token, and a `structured` /
`JSON` submessage labeled `citations`. Conversation tokens correlate independent
requests; they do not select stored chats or create persistent sessions.
The model receives text and structured evidence, while the chat UI shows the
remote agent's text reply separately.

The profile follows the message shape of `nlip-sdk==0.1.3`. Incoming questions
support text and conversation/authorization tokens, with a 16,000-character
question limit and a 64 KB request-body limit. Binary and control requests return
422. Authentication failures return 401; permissions, frozen projects, and disabled
inbound access return 403; missing projects return 404; service/model failures
return 503. Handled errors use NLIP `error` messages.

Outbound calls use a 30-second timeout, cancellation, a 256 KB response limit,
redirect rejection, and conversation-token validation when the remote service
returns a token. Remote authorization tokens are excluded from tool results.
This is a text integration, not full NLIP conformance: multimodal messages,
control negotiation, persistent sessions, and multi-hop delegation are outside
its scope.

## Configuration and local deployment

Use the existing [local development workflow](../README.md#local-development)
to start infrastructure, the backend, ingestion worker, and frontend. For a new
database, the existing development script supports:

```bash
bash infra/scripts/start-dev.sh --create-schema --no-sim
```

For an already initialized deployment, omit `--create-schema`. NLIP does not
require a Sim workspace. Follow the existing backend setup instructions for
Python dependencies and embedding configuration, and run `npm ci` in
`apps/frontend` before starting the frontend.

NLIP supplies no embedding or chat model. Document ingestion and retrieval need
an embedding service whose dimensions match the vector collection. Incoming
answers need an enabled server-side model; a browser-only WebLLM model cannot
serve an incoming HTTP request. Agent Mode also needs a working tool router and
a model that supports function calling. Configure these through the existing
provider settings. An Illinois Chat API key authorizes a caller; it is distinct
from the provider key that pays for model requests.

For local development set this in `apps/frontend/.env`, then restart the frontend:

```dotenv
NLIP_ALLOWED_ORIGINS=http://127.0.0.1:3000
```

Add any external agent origins as a comma-separated list. Matching uses the
exact scheme, hostname, and port. URLs containing credentials, a query, or a
fragment are rejected. Container deployments read the root `.env` and must use
origins reachable from the frontend container; container loopback refers to that
container. The cloud network allowlist must independently permit external hosts.

Remote-agent credentials are encrypted using the existing
`ENCRYPTION_MASTER_KEY` and stored in Redis hash `project_nlip_configs`.
Preserve Redis data and the master key across restarts. A blank token input
preserves a stored token; clearing it submits `null`. Changing the endpoint or
authentication mode requires re-entering its token. Never put tokens in URLs.

## Two-project walkthrough in the existing UI

1. Create `course_slides` and `lab_ta` using the existing project creation flow.
   Upload a course PDF stating that an outdoor trip takes place in Champaign,
   and a separate lab PDF stating that orientation starts at 09:00 at the north
   entrance. Wait for ingestion and first verify each project's own answers.
2. Open `/lab_ta/tools`, enable **Let other agents query this project**, and save.
   Select an available server model ID or leave it blank to use the project
   default. Obtain the owner/admin's active Illinois Chat API key at `/lab_ta/api`.
3. Open `/course_slides/tools` and add an enabled agent with ID `lab`, name
   `Lab TA`, description `Ask for lab orientation time and meeting place`, endpoint
   `http://127.0.0.1:3000/api/nlip/lab_ta`, and the target owner's API key. Save.
4. Enable Agent Mode in the existing project settings/chat controls. Ask:
   `For the Champaign field trip, when and where should I meet? Ask the Lab TA
   for information missing from the course slides.`
5. Expand **Agent reasoning** in `/course_slides/chat`. Confirm the actual tool
   record includes the question to Lab TA and its reply containing the meeting
   details. Confirm the final answer uses that evidence. Ordinary-chat NLIP tool
   calls show the same exchange view in their stored messages.

For an external weather agent, run a service from the
[official NLIP examples](https://github.com/nlip-project/nlip_soln), verify its
NLIP endpoint independently, add its origin to `NLIP_ALLOWED_ORIGINS`, and
register it in the same Tools form. Give it a description explaining the weather
questions it can answer. Ask the course assistant whether students should bring
a raincoat and inspect the recorded request and reply. Use the external example's
own dependencies and startup instructions.

To inspect the Illinois endpoint independently, read an API key into a local
shell variable and send a text question:

```bash
read -rs -p 'Illinois Chat API key: ' NLIP_API_KEY
curl -i http://127.0.0.1:3000/api/nlip/lab_ta \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${NLIP_API_KEY}" \
  --data '{"format":"text","subformat":"english","content":"When is orientation?"}'
unset NLIP_API_KEY
```

Without authorization expect 401. Disabling the target's inbound switch should
produce 403; stopping a registered remote service should produce a failed tool
record. Tool selection depends on the model: inspect the actual events rather
than judging delegation from the final answer alone.

## Focused verification

Use the existing Vitest runner and test directories; no additional test framework
or demo runner is required:

```bash
cd apps/frontend
npm run typecheck
npx vitest run src/server/nlip/__tests__ \
  __tests__/pages/api/__tests__/nlip.test.ts \
  __tests__/pages/api/UIUC-api/tools/__tests__/nlipRoutes.test.ts \
  src/utils/functionCalling/__tests__ \
  src/components/UIUC-Components/__tests__/NlipAgentsPanel.test.tsx \
  src/components/UIUC-Components/__tests__/SimPage.test.tsx \
  src/components/Chat/__tests__/AgentExecutionTimeline.test.tsx \
  src/components/Chat/__tests__/ChatMessage.test.tsx \
  src/components/Chat/__tests__/ChatMessage.additional.test.tsx \
  src/components/Chat/__tests__/runServerAgentMode.test.ts
```

The tests cover protocol rejection, credential encryption and destination changes,
HTTP errors and correlation, project permissions, tool discovery/dispatch, and
exchange rendering. They use model/storage/retrieval fixtures and are not proof
of real PDF ingestion or model-directed delegation. The walkthrough above requires
complete application infrastructure and configured embedding/LLM services.

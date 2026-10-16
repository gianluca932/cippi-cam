const STACK = [
  ["Qwen3-VL 235B · qwen3.5:9b", "vision: what each bird is doing, water and food (Bedrock online, Ollama locally)"],
  ["Qwen3 235B", "the chat agent: picks the tools (SQL summaries or semantic search)"],
  ["LangChain + LangGraph", "agent loop, tools and guardrail middleware"],
  ["Zod", "the contract: model output, tool arguments, HTTP bodies"],
  ["Postgres + pgvector", "the diary and search by meaning (RDS on AWS)"],
  ["AWS", "S3, SQS, Lambda, Bedrock, RDS, CloudFront, all in Terraform"],
  ["MCP", "the diary tools for any MCP client (Claude Desktop, claude.ai)"],
  ["LangSmith", "agent traces and evaluation"],
  ["Hono · React · Vite", "API and interface"],
];

export function Credits() {
  return (
    <section className="panel credits">
      <h2>Credits</h2>
      <p>
        <strong>Cippi Cam</strong> watches Cippi and Sky, the two budgies at home, classifies what they are doing
        and keeps a diary of their day that you can ask questions to in the chat.
      </p>

      <h3>Starring</h3>
      <p>🐦 Cippi (yellow) and Sky (light blue)</p>

      <h3>Built by</h3>
      <p>Gianluca Giordano, with the help of Claude Code</p>

      <h3>Stack</h3>
      <dl>
        {STACK.map(([name, role]) => (
          <div key={name} className="config-row">
            <dt>{name}</dt>
            <dd>{role}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

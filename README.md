# DocMind

> **Intelligent Document Ingestion & Retrieval-Augmented Generation (RAG) Backend**

Built with **NestJS**, **PostgreSQL** (`pgvector`), **Redis** (`BullMQ` & Caching), **OpenAI**, **Prometheus**, and **Winston**.

[![NestJS](https://img.shields.io/badge/NestJS-v11-ea2845?logo=nestjs&logoColor=white)](https://nestjs.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-v5.7-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16%20+%20pgvector-4169e1?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-7-dc382d?logo=redis&logoColor=white)](https://redis.io)
[![OpenAI](https://img.shields.io/badge/OpenAI-GPT--4o--mini-412991?logo=openai&logoColor=white)](https://openai.com)
[![Prometheus](https://img.shields.io/badge/Prometheus-Metrics-e6522c?logo=prometheus&logoColor=white)](https://prometheus.io)
[![License](https://img.shields.io/badge/License-UNLICENSED-lightgrey)]()

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [System Design & Workflows](#system-design--workflows)
  - [1. Asynchronous Ingestion Pipeline](#1-asynchronous-ingestion-pipeline)
  - [2. Semantic Search & RAG Q&A Pipeline](#2-semantic-search--rag-qa-pipeline)
  - [3. Intelligent Redis Caching](#3-intelligent-redis-caching)
  - [4. Rate Limiting & Protection](#4-rate-limiting--protection)
- [Observability & Monitoring](#observability--monitoring)
  - [Structured Logging (Winston)](#structured-logging-winston)
  - [Prometheus Metrics](#prometheus-metrics)
- [Database Schema & Indexing](#database-schema--indexing)
- [API Reference](#api-reference)
  - [Documents Endpoints](#documents-endpoints)
  - [Query & Retrieval Endpoints](#query--retrieval-endpoints)
  - [Observability Endpoints](#observability-endpoints)
- [Environment Configuration](#environment-configuration)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)

---

## Overview

DocMind is a high-performance backend platform for managing knowledge-base documents and executing low-latency **Retrieval-Augmented Generation (RAG)**. It decouples CPU- and network-heavy document processing (chunking, OpenAI embeddings generation, vector indexing) from HTTP request lifecycles using asynchronous queues, and serves semantic search and grounded AI question answering with multi-tier Redis caching and distributed rate limiting.

The platform exposes **Prometheus-compatible metrics** for production monitoring and uses **Winston structured logging** for full operational visibility.

---

## Key Features

| Category | Feature | Description |
|:---|:---|:---|
| **Ingestion** | Asynchronous Pipeline | Ingest large texts without blocking HTTP clients. Track lifecycle states (`PENDING` → `CHUNKING` → `EMBEDDING` → `READY` / `FAILED`) in real-time. |
| **Chunking** | Context-Preserving | Boundary-aware splitting prioritizes word structures with sliding window overlaps to prevent semantic cutoff. |
| **Vector DB** | Native PostgreSQL | Utilizes PostgreSQL with `pgvector` and an `ivfflat` cosine similarity index for fast vector search without external vector DB overhead. |
| **RAG** | Grounded Q&A | Synthesizes verified answers strictly from top-k matching source chunks using OpenAI `gpt-4o-mini`, complete with inline `[Source N]` citations and anti-hallucination guardrails. |
| **Caching** | Redis Response Cache | SHA-256 normalized query caching delivers instant sub-millisecond responses on repeated or similarly phrased queries (24h TTL). |
| **Security** | Distributed Rate Limiting | Redis-backed rate limiting via `@nestjs/throttler` to protect expensive LLM and vector search endpoints from abuse. |
| **Observability** | Prometheus + Winston | Production-grade metrics (`/metrics`) with custom histograms and counters, plus structured JSON logging with timestamps and execution deltas. |
| **Docs** | Interactive Swagger | Comprehensive OpenAPI spec auto-served at `/api/docs`. |

---

## Architecture

```mermaid
graph TB
    subgraph "Clients"
        CLIENT[HTTP Client / Frontend / Swagger UI]
    end

    subgraph "API & Guard Layer"
        GATEWAY[NestJS Controller]
        THROTTLE[Redis-Backed Rate Limiter]
        VALIDATION[DTO Validation Pipe]
    end

    subgraph "Ingestion Subsystem"
        DOC_SVC[Documents Service]
        BULLMQ[BullMQ Ingestion Queue]
        WORKER[Ingestion Processor]
        CHUNKER[Boundary-Aware Chunker]
    end

    subgraph "Query & RAG Subsystem"
        QUERY_SVC[Query Service]
        ANSWER_SVC[Answer Service]
        NORMALIZER[Query Normalizer & Hasher]
    end

    subgraph "Observability"
        WINSTON[Winston Structured Logger]
        PROM[Prometheus /metrics Endpoint]
    end

    subgraph "External Providers"
        OPENAI_EMBED[OpenAI Embeddings API<br/>text-embedding-3-small]
        OPENAI_CHAT[OpenAI Chat API<br/>gpt-4o-mini]
    end

    subgraph "Persistence & Infrastructure"
        REDIS[(Redis 7<br/>Queue + Cache + Throttler)]
        PG[(PostgreSQL 16 + pgvector<br/>Documents + Chunks)]
    end

    CLIENT --> THROTTLE
    THROTTLE --> GATEWAY
    GATEWAY --> VALIDATION

    %% Ingestion Flow
    VALIDATION -->|POST /documents| DOC_SVC
    DOC_SVC -->|save PENDING| PG
    DOC_SVC -->|enqueue| BULLMQ
    BULLMQ --> REDIS
    BULLMQ --> WORKER
    WORKER --> CHUNKER
    WORKER -->|batch embed| OPENAI_EMBED
    WORKER -->|batch insert chunks & vectors| PG
    WORKER -->|update status READY| PG

    %% Query & Answer Flow
    VALIDATION -->|POST /query/search| QUERY_SVC
    VALIDATION -->|POST /query/ask| ANSWER_SVC
    ANSWER_SVC --> NORMALIZER
    NORMALIZER -->|check cache| REDIS
    ANSWER_SVC -->|cache miss -> search| QUERY_SVC
    QUERY_SVC -->|embed query| OPENAI_EMBED
    QUERY_SVC -->|vector similarity search| PG
    ANSWER_SVC -->|generate grounded answer| OPENAI_CHAT
    ANSWER_SVC -->|set cache EX 86400s| REDIS

    %% Observability
    ANSWER_SVC -->|record metrics| PROM
    GATEWAY -->|structured logs| WINSTON
    CLIENT -->|GET /metrics| PROM
```

---

## Technology Stack

| Layer | Component | Details |
|:---|:---|:---|
| **Runtime** | Node.js | v20+ LTS |
| **Framework** | NestJS | v11 modular enterprise backend framework |
| **Language** | TypeScript | v5.7 with strict type checking |
| **Database** | PostgreSQL 16 | Relational storage for documents and text chunks |
| **Vector Engine** | `pgvector` | Native `vector(1536)` data type with `ivfflat` cosine similarity index |
| **ORM** | TypeORM | Entity mappings and relational transactions; raw SQL for vector operations |
| **Job Queue** | BullMQ + Redis 7 | Distributed job queue for background ingestion pipeline |
| **Caching** | Redis 7 + `ioredis` | Normalized query hash caching (24h TTL) |
| **Rate Limiting** | `@nestjs/throttler` | Distributed Redis-backed throttling storage |
| **AI / LLM** | OpenAI API | `text-embedding-3-small` (1536 dim) & `gpt-4o-mini` |
| **Metrics** | Prometheus + `prom-client` | Custom counters, histograms, and default Node.js runtime metrics via `@willsoto/nestjs-prometheus` |
| **Logging** | Winston + `nest-winston` | Structured JSON logging with timestamps, execution deltas (`ms`), and service metadata |
| **Validation** | `class-validator` / `class-transformer` | Runtime schema validation & DTO transformation |
| **Documentation** | Swagger / OpenAPI | Auto-generated interactive API documentation |

---

## System Design & Workflows

### 1. Asynchronous Ingestion Pipeline

When a document is uploaded, it is assigned a `PENDING` state and pushed to BullMQ. The client receives an immediate response with the document ID, avoiding HTTP timeouts on large texts.

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant Controller as Documents Controller
    participant Service as Documents Service
    participant Queue as BullMQ Queue
    participant Worker as Ingestion Processor
    participant Chunker as Chunking Utility
    participant Embedder as Embeddings Service
    participant OpenAI as OpenAI API
    participant DB as PostgreSQL (pgvector)

    Client->>Controller: POST /documents { title, content }
    Controller->>Service: submitDocument(dto)
    Service->>DB: INSERT Document (status: PENDING)
    Service->>Queue: add("ingest-doc", { documentId })
    Service-->>Controller: Document record
    Controller-->>Client: 201 Created { id, status: PENDING }

    Queue->>Worker: process(job)
    Worker->>DB: UPDATE Document SET status = 'CHUNKING'
    Worker->>Chunker: chunkText(content, { size: 1200, overlap: 200 })
    Chunker-->>Worker: string[] chunks

    Worker->>DB: UPDATE Document SET status = 'EMBEDDING'
    loop Batches of 20 Chunks
        Worker->>Embedder: embedBatch(chunkBatch)
        Embedder->>OpenAI: POST /v1/embeddings (text-embedding-3-small)
        OpenAI-->>Embedder: number[][] vectors (1536 dim)
        Worker->>DB: INSERT INTO chunks (documentId, chunkIndex, content, embedding)
    end

    Worker->>DB: UPDATE Document SET status = 'READY'
    Client->>Controller: GET /documents/:id
    Controller-->>Client: 200 OK { id, status: READY }
```

### 2. Semantic Search & RAG Q&A Pipeline

Queries are converted into embeddings and matched against document chunks via vector cosine distance (`c.embedding <-> $1`). For Q&A requests, retrieved chunks are injected into a strict system prompt provided to `gpt-4o-mini`.

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant Controller as Query Controller
    participant AnswerSvc as Answer Service
    participant Prometheus as Prometheus Metrics
    participant Redis as Redis Cache
    participant QuerySvc as Query Service
    participant OpenAI as OpenAI (Embeddings & Chat)
    participant DB as PostgreSQL (pgvector)

    Client->>Controller: POST /query/ask { query: "What is DocMind?" }
    Controller->>AnswerSvc: askQuestion(dto)
    AnswerSvc->>Prometheus: queriesCounter.inc()
    AnswerSvc->>AnswerSvc: Normalize & SHA-256 Hash query
    AnswerSvc->>Redis: GET docmind:cache:ask:<hash>
    
    alt Cache HIT
        Redis-->>AnswerSvc: Cached Answer JSON
        AnswerSvc->>Prometheus: cacheHitsCounter.inc()
        AnswerSvc-->>Controller: AnswerResponse { answer, sources, isCached: true }
        Controller-->>Client: 200 OK Response
    else Cache MISS
        Redis-->>AnswerSvc: null
        AnswerSvc->>QuerySvc: search({ query, limit: 5 })
        QuerySvc->>OpenAI: Embed query string
        OpenAI-->>QuerySvc: query vector [1536]
        QuerySvc->>DB: SELECT chunks ORDER BY embedding <-> $1 LIMIT 5
        DB-->>QuerySvc: SearchResult[]
        QuerySvc-->>AnswerSvc: Top matching chunks
        
        AnswerSvc->>Prometheus: generationTimer.startTimer()
        AnswerSvc->>OpenAI: POST /v1/chat/completions (Grounding Prompt + Context)
        OpenAI-->>AnswerSvc: Generated Answer with [Source N] citations
        AnswerSvc->>Prometheus: generationTimer.end()
        AnswerSvc->>Redis: SET docmind:cache:ask:<hash> (EX 86400s)
        AnswerSvc-->>Controller: AnswerResponse { answer, sources, isCached: false }
        Controller-->>Client: 200 OK Response
    end
```

### 3. Intelligent Redis Caching

The `AnswerService` normalizes user queries (case folding, stripping punctuation, collapsing whitespace) before computing a deterministic SHA-256 hash. Cached results expire after 24 hours (86,400 seconds) and include complete source metadata and citations.

### 4. Rate Limiting & Protection

DocMind uses `@nestjs/throttler` backed by Redis storage to enforce rate limits across distributed instances:
- **Global / Default**: 10 requests / minute
- **`/query/search`**: 20 requests / minute
- **`/query/ask`**: 5 requests / minute

---

## Observability & Monitoring

DocMind ships with production-grade observability built-in, requiring **zero external configuration** to start collecting metrics and structured logs.

### Structured Logging (Winston)

The application uses **Winston** via `nest-winston` as the global NestJS logger, replacing the default console logger with structured, machine-parseable output:

| Feature | Details |
|:---|:---|
| **Format** | JSON with `timestamp` and `ms` (execution delta) fields |
| **Service Metadata** | Every log line includes `{ service: "docmind-api" }` |
| **Console Transport** | Human-readable `simple()` format for development |
| **Log Level** | `debug` (captures all severity levels) |

**Example Log Output:**
```json
{
  "level": "info",
  "message": "Cache MISS for query: \"What is RAG?\". Running pipeline...",
  "service": "docmind-api",
  "timestamp": "2026-09-02T12:00:00.000Z",
  "ms": "+215ms"
}
```

### Prometheus Metrics

A Prometheus-compatible metrics endpoint is exposed at **`GET /metrics`** via `@willsoto/nestjs-prometheus`. Default Node.js runtime metrics (event loop lag, heap usage, GC, etc.) are enabled automatically.

#### Custom Application Metrics

| Metric Name | Type | Description | Labels / Buckets |
|:---|:---|:---|:---|
| `rag_queries_total` | Counter | Total RAG queries received via `/query/ask` | — |
| `rag_cache_hits_total` | Counter | Queries served directly from Redis cache | — |
| `llm_generation_duration_seconds` | Histogram | Time spent waiting for OpenAI Chat API response | `0.5, 1, 2, 5, 10` seconds |
| `vector_search_latency_seconds` | Histogram | Latency of pgvector cosine similarity search | `0.001, 0.005, 0.01, 0.05, 0.1` seconds |

#### Monitoring Architecture

```mermaid
graph LR
    APP["DocMind API<br/>(NestJS)"] -->|GET /metrics| PROM["Prometheus<br/>Scraper"]
    PROM --> GRAFANA["Grafana<br/>Dashboard"]
    APP -->|stdout / stderr| WINSTON["Winston<br/>JSON Logs"]
    WINSTON --> LOG_AGG["Log Aggregator<br/>(ELK / Loki / CloudWatch)"]
```

#### Example Prometheus Queries

```promql
# Cache hit rate (last 5 minutes)
rate(rag_cache_hits_total[5m]) / rate(rag_queries_total[5m])

# 95th percentile LLM generation latency
histogram_quantile(0.95, rate(llm_generation_duration_seconds_bucket[5m]))

# Average vector search latency
rate(vector_search_latency_seconds_sum[5m]) / rate(vector_search_latency_seconds_count[5m])
```

---

## Database Schema & Indexing

```mermaid
erDiagram
    Document ||--o{ Chunk : "contains"

    Document {
        uuid id PK
        string title
        text sourceContent
        enum status "PENDING | CHUNKING | EMBEDDING | READY | FAILED"
        text failureReason
        datetime createdAt
    }

    Chunk {
        uuid id PK
        uuid documentId FK
        int chunkIndex
        text content
        vector embedding "vector(1536)"
        datetime createdAt
    }
```

### Vector Index Configuration

Vector similarity lookups use an `ivfflat` index configured with cosine distance operations (`vector_cosine_ops`):

```sql
CREATE INDEX IF NOT EXISTS chunks_embedding_idx 
ON chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

---

## API Reference

Interactive Swagger documentation is available at `http://localhost:3000/api/docs`.

### Documents Endpoints

#### 1. Ingest Document
`POST /documents`

Queues a new document for background chunking, embedding, and vector indexing.

**Request Body**
```json
{
  "title": "DocMind Architecture Overview",
  "content": "DocMind is an asynchronous RAG backend built on NestJS and PostgreSQL..."
}
```

**Response (`201 Created`)**
```json
{
  "message": "Document queued for ingestion",
  "id": "c7b5f3a0-8e1d-4d74-912b-3a4d5e6f7a8b",
  "status": "PENDING"
}
```

#### 2. List Documents
`GET /documents`

**Response (`200 OK`)**
```json
[
  {
    "id": "c7b5f3a0-8e1d-4d74-912b-3a4d5e6f7a8b",
    "title": "DocMind Architecture Overview",
    "status": "READY",
    "failureReason": null,
    "createdAt": "2026-09-02T10:00:00.000Z"
  }
]
```

#### 3. Get Document Status
`GET /documents/:id`

**Response (`200 OK`)**
```json
{
  "id": "c7b5f3a0-8e1d-4d74-912b-3a4d5e6f7a8b",
  "title": "DocMind Architecture Overview",
  "status": "READY",
  "failureReason": null,
  "createdAt": "2026-09-02T10:00:00.000Z"
}
```

#### 4. Delete Document
`DELETE /documents/:id`

Deletes a document record and purges all associated text chunks and vector embeddings from PostgreSQL.

**Response (`200 OK`)**
```json
{
  "message": "Document and associated chunks deleted successfully",
  "id": "c7b5f3a0-8e1d-4d74-912b-3a4d5e6f7a8b"
}
```

---

### Query & Retrieval Endpoints

#### 5. Semantic Vector Search
`POST /query/search`

Performs vector similarity search over all `READY` document chunks. Throttled to **20 requests/minute**.

**Request Body**
```json
{
  "query": "How does DocMind handle background processing?",
  "limit": 3
}
```

**Response (`200 OK`)**
```json
{
  "query": "How does DocMind handle background processing?",
  "count": 1,
  "results": [
    {
      "chunkId": "f9e2b10a-3c4d-4e5f-9a8b-1c2d3e4f5a6b",
      "content": "DocMind uses BullMQ backed by Redis for background processing...",
      "similarity": 0.8924,
      "documentTitle": "DocMind Architecture Overview",
      "documentId": "c7b5f3a0-8e1d-4d74-912b-3a4d5e6f7a8b"
    }
  ]
}
```

#### 6. Ask Question (RAG with Citations)
`POST /query/ask`

Executes the full RAG pipeline: retrieves top-k chunks, queries OpenAI for a grounded answer with inline citations, and caches the result in Redis. Throttled to **5 requests/minute**.

**Request Body**
```json
{
  "query": "How does DocMind handle background processing?"
}
```

**Response (`200 OK`)**
```json
{
  "query": "How does DocMind handle background processing?",
  "answer": "DocMind handles background processing using BullMQ backed by Redis [Source 1]. This ensures document ingestion and embedding generation do not block HTTP request lifecycles.",
  "sources": [
    {
      "citation": "[Source 1]",
      "documentTitle": "DocMind Architecture Overview",
      "chunkId": "f9e2b10a-3c4d-4e5f-9a8b-1c2d3e4f5a6b",
      "similarity": 0.8924
    }
  ],
  "isCached": false
}
```

---

### Observability Endpoints

#### 7. Prometheus Metrics
`GET /metrics`

Returns all application and runtime metrics in Prometheus exposition format. Includes both default Node.js metrics (heap, GC, event loop) and custom RAG pipeline metrics.

**Response (`200 OK`, `text/plain`)**
```text
# HELP rag_queries_total Total number of RAG queries received
# TYPE rag_queries_total counter
rag_queries_total 42

# HELP rag_cache_hits_total Total number of RAG queries served from Redis cache
# TYPE rag_cache_hits_total counter
rag_cache_hits_total 28

# HELP llm_generation_duration_seconds Time spent waiting for the OpenAI Chat API
# TYPE llm_generation_duration_seconds histogram
llm_generation_duration_seconds_bucket{le="0.5"} 2
llm_generation_duration_seconds_bucket{le="1"} 8
llm_generation_duration_seconds_bucket{le="2"} 12
llm_generation_duration_seconds_bucket{le="5"} 14
llm_generation_duration_seconds_bucket{le="10"} 14
llm_generation_duration_seconds_bucket{le="+Inf"} 14
llm_generation_duration_seconds_sum 21.54
llm_generation_duration_seconds_count 14

# HELP vector_search_latency_seconds Latency of vector similarity search in PostgreSQL
# TYPE vector_search_latency_seconds histogram
vector_search_latency_seconds_bucket{le="0.001"} 5
vector_search_latency_seconds_bucket{le="0.005"} 18
vector_search_latency_seconds_bucket{le="0.01"} 25
vector_search_latency_seconds_bucket{le="0.05"} 40
vector_search_latency_seconds_bucket{le="0.1"} 42
vector_search_latency_seconds_bucket{le="+Inf"} 42
vector_search_latency_seconds_sum 0.386
vector_search_latency_seconds_count 42
```

#### 8. Health Check
`GET /health`

Performs active probes against PostgreSQL and Redis, reporting uptime, memory usage, and component latency. Returns HTTP 200 when healthy or HTTP 503 if any dependency is degraded.

**Response (`200 OK`)**
```json
{
  "status": "ok",
  "timestamp": "2026-09-02T13:00:00.000Z",
  "uptimeSeconds": 3600,
  "responseTimeMs": 4,
  "memory": {
    "heapUsedMb": 45.12,
    "heapTotalMb": 62.45,
    "rssMb": 98.32
  },
  "services": {
    "database": {
      "status": "up",
      "latencyMs": 2
    },
    "redis": {
      "status": "up",
      "latencyMs": 1
    }
  }
}
```

---

### Standardized Error Format

All exceptions (both HTTP client errors and unhandled server errors) are intercepted by the global `AllExceptionsFilter` and returned in a unified JSON structure:

```json
{
  "statusCode": 404,
  "timestamp": "2026-09-02T13:00:00.000Z",
  "path": "/documents/c7b5f3a0-8e1d-4d74-912b-3a4d5e6f7a8b",
  "method": "DELETE",
  "error": "Not Found",
  "message": "Document with ID c7b5f3a0-8e1d-4d74-912b-3a4d5e6f7a8b not found"
}
```

---

## Environment Configuration

Configure application settings via environment variables (or `.env` file):

| Variable | Type | Default | Description |
|:---|:---|:---|:---|
| `PORT` | number | `3000` | HTTP application port |
| `DATABASE_URL` | string | `postgresql://docmind:docmind_password@localhost:5432/docmind` | PostgreSQL connection string |
| `REDIS_HOST` | string | `localhost` | Redis server hostname |
| `REDIS_PORT` | number | `6379` | Redis server port |
| `OPENAI_API_KEY` | string | — | OpenAI API Key (**Required**) |
| `EMBEDDING_MODEL` | string | `text-embedding-3-small` | OpenAI embedding model |
| `EMBEDDING_DIMENSIONS` | number | `1536` | Dimensionality of embedding vectors |
| `CHAT_MODEL` | string | `gpt-4o-mini` | OpenAI Chat model for RAG synthesis |
| `CHUNK_SIZE_CHARS` | number | `1200` | Maximum character length per text chunk |
| `CHUNK_OVERLAP_CHARS` | number | `200` | Character overlap between consecutive chunks |
| `RATE_LIMIT_TTL` | number | `60000` | Throttler time-to-live window in milliseconds |
| `RATE_LIMIT_MAX` | number | `10` | Default maximum requests per TTL window |

---

## Getting Started

### Prerequisites

- **Node.js** (v20+ LTS)
- **Docker** & **Docker Compose**
- **OpenAI API Key**

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/mo74x/Docmind.git
cd Docmind
npm install
```

### 2. Configure Environment

Copy the environment template and provide your OpenAI API key:

```bash
cp .env.example .env
```

Edit `.env`:
```env
OPENAI_API_KEY=sk-your-openai-api-key
```

### 3. Start Infrastructure

Start PostgreSQL (with `pgvector`) and Redis containers:

```bash
docker compose up -d
```

### 4. Run Vector Migrations

Initialize the `pgvector` extension, chunk vector column, and `ivfflat` index:

```bash
npx ts-node src/migrations/run-pgvector.ts
```

### 5. Start Application

```bash
# Development (with hot-reload)
npm run start:dev

# Production build
npm run build
npm run start:prod
```

### Available Endpoints

| Endpoint | Description |
|:---|:---|
| `http://localhost:3000` | API Server |
| `http://localhost:3000/api/docs` | Interactive Swagger UI |
| `http://localhost:3000/health` | Health Check (DB & Redis) |
| `http://localhost:3000/metrics` | Prometheus Metrics |

---

## Project Structure

```text
docmind/
├── docker-compose.yml              # PostgreSQL (pgvector) & Redis containers
├── .env.example                    # Environment configuration template
├── package.json
├── tsconfig.json
├── src/
│   ├── main.ts                     # Bootstrap, Swagger, Winston Logger, Filters & Validation
│   ├── app.module.ts               # Root module (TypeORM, Redis, BullMQ, Throttler, Prometheus, Health)
│   ├── common/
│   │   └── filters/
│   │       └── all-exceptions.filter.ts # Global exception filter & structured error logging
│   ├── config/
│   │   └── configuration.ts        # Config loader & environment parsing
│   ├── health/
│   │   ├── health.controller.ts    # DB & Redis connectivity & uptime health probe
│   │   └── health.module.ts
│   ├── migrations/
│   │   └── run-pgvector.ts         # pgvector extension & ivfflat index migration
│   ├── documents/
│   │   ├── document.entity.ts      # Document entity & lifecycle status enum
│   │   ├── chunk.entity.ts         # Chunk entity with vector(1536) column
│   │   ├── documents.controller.ts # Ingestion, status, & DELETE endpoints
│   │   ├── documents.service.ts    # Document state management, queue producer & deletion
│   │   ├── documents.module.ts
│   │   └── dto/
│   │       └── ingest-document.dto.ts
│   ├── ingestion/
│   │   ├── ingestion.processor.ts  # BullMQ worker: chunking -> batch embedding -> DB
│   │   ├── chunking.util.ts        # Boundary-aware text chunking logic
│   │   └── ingestion.module.ts
│   ├── embeddings/
│   │   ├── embeddings.service.ts   # OpenAI batch embeddings client
│   │   └── embeddings.module.ts
│   ├── query/
│   │   ├── query.controller.ts     # Semantic search & Q&A endpoints with rate limits
│   │   ├── query.service.ts        # Vector similarity search over pgvector
│   │   ├── answer.service.ts       # RAG answer synthesis, Redis caching & Prometheus instrumentation
│   │   ├── query.module.ts         # Prometheus metric providers (counters & histograms)
│   │   └── dto/
│   │       └── search-query.dto.ts # Query validation DTO
│   └── redis/
│       └── redis.module.ts         # Global Redis client provider
```
# GitHub CodeQL App - Flow Diagrams

This document contains visual flow diagrams for the GitHub CodeQL App. These diagrams can be viewed in any Markdown viewer that supports Mermaid diagrams (GitHub, GitLab, VS Code with Mermaid extension, etc.).

## Main Application Flow

```mermaid
graph TD
    A[GitHub App Installation] --> B[Installation Webhook]
    B --> C[Store Installation in DB]
    C --> D[Ensure CodeQL Workflow on Repos]
    
    E[Release Published] --> F[Release Webhook]
    F --> G[Create Temporary Branch]
    G --> H[Copy CodeQL Workflow to Temp Branch]
    H --> I[Dispatch CodeQL Workflow]
    
    I --> J[CodeQL Analysis Running]
    J --> K[Workflow Run Completed]
    K --> L[Fetch CodeQL Alerts]
    L --> M[Store Alerts in Database]
    M --> N[Generate Vulnerability Report]
    N --> O[Push Report to Repository]
    O --> P[Delete Temporary Branch]
    P --> Q[Store Report in Database]
    
    R[Repository Access Changed] --> S[Installation Repositories Webhook]
    S --> T[Update Repository List]
    T --> U[Ensure Workflows on New Repos]
    
    V[App Uninstalled] --> W[Installation Deleted Webhook]
    W --> X[Soft Delete Installation]
    
    style A fill:#e1f5fe
    style E fill:#e8f5e8
    style R fill:#fff3e0
    style V fill:#ffebee
    style Q fill:#f3e5f5
```

## Component Interaction Diagram

```mermaid
graph LR
    A[GitHub Webhooks] --> B[Express Server]
    B --> C[MongoDB Database]
    B --> D[GitHub API Client]
    D --> E[GitHub API]
    
    F[CodeQL Workflow] --> G[GitHub Actions]
    G --> H[Security Alerts]
    H --> D
    
    I[Report Generator] --> J[Markdown Report]
    J --> D
    
    style A fill:#e3f2fd
    style B fill:#e8f5e8
    style C fill:#fff3e0
    style D fill:#f3e5f5
    style E fill:#ffebee
```

## Database Entity Relationship Diagram

```mermaid
erDiagram
    Installation ||--o{ Repo : "has many"
    Installation ||--o{ Workflow : "tracks"
    Repo ||--o{ Alert : "contains"
    Repo ||--o{ Report : "generates"
    Workflow ||--|| Report : "creates"
    
    Installation {
        number installationId PK
        object account
        array repos FK
        date deletedAt
    }
    
    Repo {
        number repoId PK
        string owner
        string name
        boolean hasCodeQL
        date deletedAt
    }
    
    Alert {
        number alertId PK
        string severity
        string file
        string message
        string repo FK
        date deletedAt
    }
    
    Workflow {
        string owner
        string repo
        number installationId FK
        string releaseTag
        string sourceBranch
        string tempBranch
        date createdAt
    }
    
    Report {
        string owner
        string repo
        string branch
        string tag
        string content
    }
```

## Webhook Event Flow

```mermaid
sequenceDiagram
    participant GH as GitHub
    participant WH as Webhook Handler
    participant DB as Database
    participant API as GitHub API
    participant WF as CodeQL Workflow
    
    Note over GH,WF: Installation Flow
    GH->>WH: installation.created
    WH->>DB: Store installation
    WH->>API: Get repositories
    WH->>API: Ensure CodeQL workflow
    
    Note over GH,WF: Release Analysis Flow
    GH->>WH: release.published
    WH->>API: Create temp branch
    WH->>API: Copy workflow to temp branch
    WH->>API: Dispatch workflow
    API->>WF: Trigger CodeQL analysis
    WF->>GH: Generate security alerts
    GH->>WH: workflow_run.completed
    WH->>API: Fetch alerts
    WH->>DB: Store alerts
    WH->>WH: Generate report
    WH->>API: Push report to repo
    WH->>API: Delete temp branch
    WH->>DB: Store report
```

## How to View These Diagrams

### Option 1: GitHub/GitLab
- These diagrams will render automatically when viewing this file on GitHub or GitLab

### Option 2: VS Code
- Install the "Mermaid Preview" extension
- Open this file and use the preview pane

### Option 3: Online Mermaid Editor
- Copy the diagram code to [mermaid.live](https://mermaid.live)
- View and export as PNG/SVG

### Option 4: Command Line
```bash
# Install mermaid-cli
npm install -g @mermaid-js/mermaid-cli

# Generate PNG from diagram
mmdc -i FLOW_DIAGRAMS.md -o diagrams.png
```

### Option 5: Browser Extension
- Install "Mermaid Diagrams" browser extension
- View diagrams directly in your browser

# GitHub CodeQL App - Development Documentation

## Overview

The GitHub CodeQL App is a Node.js/TypeScript application that automates CodeQL security scanning for GitHub repositories. It integrates with GitHub Apps to provide automated vulnerability scanning and reporting for releases.

## Architecture

### Core Components

- **Express Server** (`src/server.ts`): Main application server with API routes and webhook handlers
- **GitHub App Integration** (`src/github-app.ts`): Handles GitHub App authentication and token management
- **GitHub API Client** (`src/github-api.ts`): Core GitHub API interactions for workflow management
- **Data Models** (`src/models/`): MongoDB schemas for installations, repositories, alerts, and reports
- **Webhook Handlers** (`src/routes/webhooks.ts`): Processes GitHub webhook events
- **API Routes** (`src/routes/api/`): RESTful endpoints for managing installations, repos, alerts, and reports

### Data Flow

1. **Installation**: GitHub App is installed on repositories
2. **Release Trigger**: When a release is published, the app creates a temporary branch
3. **CodeQL Analysis**: CodeQL workflow runs on the temporary branch
4. **Alert Processing**: Alerts are fetched and stored in the database
5. **Report Generation**: Vulnerability report is generated and pushed to the repository
6. **Cleanup**: Temporary branch is deleted

## Technology Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: GitHub App JWT tokens
- **Webhooks**: GitHub webhook signature verification
- **Development**: Nodemon for hot reloading

## Project Structure

```
src/
├── config.ts              # Environment configuration
├── server.ts              # Main application entry point
├── github-app.ts          # GitHub App authentication
├── github-api.ts          # GitHub API client functions
├── models/                # MongoDB data models
│   ├── alert.ts          # Security alert schema
│   ├── installation.ts   # GitHub App installation schema
│   ├── repo.ts           # Repository schema
│   ├── report.ts         # Generated report schema
│   ├── workflow.ts       # Workflow tracking schema
│   └── index.ts          # Model exports
├── routes/               # API routes and webhooks
│   ├── api/             # REST API endpoints
│   │   ├── alerts.ts    # Alert management
│   │   ├── installations.ts # Installation management
│   │   ├── reports.ts   # Report management
│   │   └── repos.ts     # Repository management
│   └── webhooks.ts      # GitHub webhook handlers
└── utils/               # Utility functions
    ├── md.ts            # Markdown report generation
    ├── retry.ts         # Retry logic utilities
    └── verify-github-signature.ts # Webhook signature verification
```

## Environment Configuration

### Required Environment Variables

```bash
# Database
MONGO_URI=mongodb://localhost:27017/codeql_manager

# GitHub App Configuration
GITHUB_APP_ID=your_app_id
GITHUB_PRIVATE_KEY_PATH=/path/to/private-key.pem
WEBHOOK_SECRET=your_webhook_secret

# Server Configuration
PORT=3000
```

### Configuration File

The `src/config.ts` file handles environment variable loading and validation:

```typescript
export const CONFIG = {
  port: Number(process.env.PORT || 3000),
  mongoUri: process.env.MONGO_URI || "",
  webhookSecret: process.env.WEBHOOK_SECRET || "",
  appId: process.env.GITHUB_APP_ID || "",
  privateKeyPath: process.env.GITHUB_PRIVATE_KEY_PATH || "",
  privateKey: "", // Loaded from file
};
```

## Data Models

### Installation Model

Tracks GitHub App installations and associated repositories:

```typescript
interface IInstallation {
  installationId: number;
  account: {
    login: string;
    id: number;
  };
  repos: Types.DocumentArray<IRepo>;
  deletedAt?: Date | null;
}
```

### Repository Model

Stores repository information and CodeQL status:

```typescript
interface IRepo {
  repoId: number;
  owner: string;
  name: string;
  hasCodeQL: boolean;
  deletedAt: Date;
}
```

### Alert Model

Stores security alerts from CodeQL analysis:

```typescript
interface IAlert {
  alertId: number;
  severity: "low" | "medium" | "high";
  file: string;
  message: string;
  repo: string; // "owner/repo" format
  deletedAt: Date;
}
```

### Workflow Model

Tracks in-flight CodeQL workflows:

```typescript
interface IWorkflow {
  owner: string;
  repo: string;
  installationId: number;
  releaseTag: string;
  sourceBranch: string;
  tempBranch: string;
  createdAt: Date;
  deletedAt: Date;
}
```

### Report Model

Stores generated vulnerability reports:

```typescript
interface IReport {
  owner: string;
  repo: string;
  branch: string;
  tag: string;
  content: string; // Markdown content
}
```

## API Endpoints

### Installations API (`/api/installations`)

- `GET /` - List all installations with repositories
- `GET /:installationId/repos` - Get repositories for a specific installation
- `POST /sync/:installationId` - Re-sync repositories from GitHub

### Repositories API (`/api/repos`)

- `GET /` - List all repositories
- `GET /:repoId` - Get specific repository details
- `POST /:repoId/ensure-workflow` - Ensure CodeQL workflow exists

### Alerts API (`/api/alerts`)

- `GET /` - List all alerts (with filtering options)
- `GET /:alertId` - Get specific alert details
- `PUT /:alertId` - Update alert status

### Reports API (`/api/reports`)

- `GET /` - List all generated reports
- `GET /:reportId` - Get specific report content
- `GET /repo/:owner/:repo` - Get reports for a specific repository

## Webhook Events

The application handles several GitHub webhook events:

### Installation Events

- `installation.created` - New app installation
- `installation.deleted` - App uninstalled
- `installation_repositories` - Repository access changed

### Release Events

- `release.published` - Triggers CodeQL analysis for new releases

### Workflow Events

- `workflow_run.completed` - Processes CodeQL analysis results

## Development Setup

### Prerequisites

- Node.js 18+
- MongoDB 4.4+
- GitHub App with appropriate permissions

### Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd github-codeql-app
```

2. Install dependencies:

```bash
npm install
```

3. Set up environment variables:

```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Start MongoDB:

```bash
mongod
```

5. Run the development server:

```bash
npm run dev
```

### Available Scripts

- `npm run dev` - Start development server with hot reloading
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Start production server

## GitHub App Setup

### Required Permissions

- **Repository permissions**:

  - Contents: Read & Write
  - Metadata: Read
  - Pull requests: Read
  - Security events: Write
  - Actions: Read

- **Subscribe to events**:
  - Installation
  - Installation repositories
  - Release
  - Workflow run

### Webhook Configuration

- **Payload URL**: `https://your-domain.com/webhooks/github`
- **Content type**: `application/json`
- **Secret**: Use the same secret as `WEBHOOK_SECRET`

## CodeQL Workflow

The application uses a custom CodeQL workflow (`codeql-default-workflow .yml`) that:

1. Runs on pushes to main branch
2. Supports multiple languages (JavaScript/TypeScript, Python, Java, etc.)
3. Uses GitHub's CodeQL action for analysis
4. Generates security alerts for vulnerabilities

### Workflow Management

The app automatically:

- Ensures CodeQL workflow exists on default branches
- Creates temporary branches for release analysis
- Dispatches workflows for analysis
- Cleans up temporary branches after completion

## Security Considerations

### Webhook Security

- All webhooks are verified using HMAC-SHA256 signatures
- Raw body parsing is used for webhook routes to ensure signature verification

### Authentication

- GitHub App JWT tokens are used for API authentication
- Installation tokens are generated per-request for repository access
- Private keys are loaded from filesystem (not stored in environment)

### Data Protection

- Soft deletion is used for all models (deletedAt field)
- Sensitive data is not logged
- Database connections use proper authentication

## Monitoring and Logging

### Health Check

- `GET /healthz` - Returns application health status

### Logging

The application logs:

- Webhook events received
- Installation changes
- Workflow completions
- Error conditions

### Error Handling

- Comprehensive error handling in webhook routes
- Graceful degradation for API failures
- Retry logic for transient failures

## Deployment

### Production Considerations

1. **Environment Variables**: Ensure all required environment variables are set
2. **Database**: Use a production MongoDB instance
3. **SSL/TLS**: Use HTTPS for webhook endpoints
4. **Scaling**: Consider horizontal scaling for high-volume installations
5. **Monitoring**: Implement application monitoring and alerting

### Docker Deployment

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/
EXPOSE 3000
CMD ["npm", "start"]
```

## Troubleshooting

### Common Issues

1. **Webhook signature verification fails**

   - Check `WEBHOOK_SECRET` matches GitHub App configuration
   - Ensure raw body parsing is used for webhook routes

2. **GitHub API rate limiting**

   - Implement exponential backoff
   - Use installation tokens efficiently

3. **MongoDB connection issues**

   - Verify `MONGO_URI` is correct
   - Check network connectivity to database

4. **CodeQL workflow not triggering**
   - Verify repository has CodeQL workflow file
   - Check GitHub App permissions
   - Ensure workflow file is valid YAML

### Debug Mode

Enable debug logging by setting:

```bash
DEBUG=github-codeql-app:*
```

## Contributing

### Code Style

- Use TypeScript strict mode
- Follow ESLint configuration
- Use meaningful variable and function names
- Add JSDoc comments for public APIs

### Testing

- Write unit tests for utility functions
- Test webhook handlers with mock payloads
- Integration tests for API endpoints

### Pull Request Process

1. Create feature branch from main
2. Make changes with tests
3. Update documentation if needed
4. Submit pull request with description

## License

[Add your license information here]

## Support

For issues and questions:

- Create GitHub issues for bugs
- Use discussions for feature requests
- Check existing documentation first


## Application Flow Diagrams

For detailed visual flow diagrams, see [FLOW_DIAGRAMS.md](./FLOW_DIAGRAMS.md).

The application flow includes:

1. **Installation Phase**: GitHub App installation and repository setup
2. **Release Analysis Phase**: Automated CodeQL scanning triggered by releases
3. **Repository Management Phase**: Handling repository access changes
4. **Uninstallation Phase**: Graceful cleanup when app is removed

### Quick Flow Summary

```
GitHub App Installation → Store in DB → Ensure CodeQL Workflows
Release Published → Create Temp Branch → Run CodeQL → Generate Report → Cleanup
Repository Changes → Update Access → Ensure Workflows on New Repos
App Uninstalled → Soft Delete Installation
```

### Key Components

- **Webhook Handlers**: Process GitHub events
- **GitHub API Client**: Interact with GitHub repositories
- **MongoDB Database**: Store installations, repos, alerts, and reports
- **Report Generator**: Create markdown vulnerability reports
- **Workflow Manager**: Handle CodeQL workflow lifecycle

For complete visual diagrams with Mermaid syntax, refer to the dedicated [FLOW_DIAGRAMS.md](./FLOW_DIAGRAMS.md) file.


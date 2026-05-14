# 🚀 Enterprise URL Shortener API

A highly scalable, production-grade URL shortening service built with Node.js. This project was engineered from the ground up to handle massive traffic spikes using advanced distributed systems architecture, including read-through caching, asynchronous background workers, and Kubernetes orchestration.

![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Express.js](https://img.shields.io/badge/Express.js-404D59?style=for-the-badge)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/redis-%23DD0031.svg?style=for-the-badge&logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=for-the-badge&logo=docker&logoColor=white)
![Kubernetes](https://img.shields.io/badge/kubernetes-%23326ce5.svg?style=for-the-badge&logo=kubernetes&logoColor=white)
![Prometheus](https://img.shields.io/badge/Prometheus-E6522C?style=for-the-badge&logo=Prometheus&logoColor=white)
![Grafana](https://img.shields.io/badge/grafana-%23F46800.svg?style=for-the-badge&logo=grafana&logoColor=white)

---

## 🌟 Key Features

*   **Lightning Fast Redirects:** Utilizes a **Redis Read-Through Cache**. When a user requests a short link, the API checks Redis first. If the URL is cached, it redirects instantly (~2ms), completely bypassing the PostgreSQL database.
*   **Asynchronous Analytics:** Writing click analytics to a database is slow. This API uses **BullMQ** to offload click-tracking to a dedicated background worker process. This guarantees that end-users experience zero latency when being redirected.
*   **Distributed Rate Limiting:** Protected against spam and abuse via `express-rate-limit` backed by Redis. Limits apply globally across all scaled API instances.
*   **Custom Aliases:** Users can define their own custom short link names (e.g., `/my-resume`), protected by conflict validation.
*   **Deep Observability:** Fully instrumented with **Prometheus** metrics and pre-provisioned **Grafana** dashboards to monitor HTTP traffic, system health, and worker queue status in real-time.
*   **Cloud Native Orchestration:** Includes complete **Kubernetes** manifests (StatefulSets, PVCs, Deployments, and Ingress) for deployment to AWS EKS, GKE, or any enterprise K8s cluster.
*   **Automated Testing & CI/CD:** Built-in Jest test suite running in an automated GitHub Actions pipeline with real service containers (Postgres/Redis) for integration testing on every pull request.

---

## 🏗️ Architecture

The system is decoupled into several microservices to allow independent scaling:
1.  **API Service (Node/Express):** Handles HTTP requests, validation, caching, and queueing.
2.  **Worker Service (Node):** Listens to BullMQ and executes heavy database writes for analytics.
3.  **PostgreSQL Database:** The persistent source of truth for URLs and analytics.
4.  **Redis Store:** Acts as both an ultra-fast cache layer and the message broker for BullMQ.
5.  **Monitoring Stack:** Prometheus scrapes metrics from the API, visualized by Grafana.

---

## 💻 Getting Started (Local Development)

The easiest way to run the entire stack locally is using Docker Compose.

### Prerequisites
*   [Docker Desktop](https://www.docker.com/products/docker-desktop) installed and running.
*   Node.js v18+ (for local CLI testing).

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/url-shortener.git
   cd url-shortener
   ```

2. Start the entire infrastructure (API, Worker, Postgres, Redis, Prometheus, Grafana) in the background:
   ```bash
   docker-compose up -d --build
   ```

3. The API will now be running on port `80` (via Nginx) and `3000` (Directly).

---

## 📖 API Documentation (Swagger)

The project includes an interactive Swagger dashboard. Once the server is running, navigate to:
👉 **`http://localhost:3000/api-docs`**

From there, you can test endpoints directly:
*   `POST /shorten` - Create a short URL (with optional custom alias).
*   `GET /{code}` - The redirector.
*   `GET /queue/stats` - Monitor the BullMQ background worker queue.
*   `GET /healthz` & `/ready` - Kubernetes health probes.

---

## 📊 Observability (Grafana)

To view real-time traffic, system latency, and URL generation statistics:
1. Navigate to: **`http://localhost:3001`**
2. Login with Username: `admin` / Password: `admin`
3. Click on the pre-provisioned **URL Shortener API Metrics** dashboard.

---

## ☸️ Kubernetes Deployment

To deploy this application to a Kubernetes cluster (e.g., Minikube for local testing):

1. Apply the configuration maps and secrets:
   ```bash
   kubectl apply -f k8s/configmap.yaml
   kubectl apply -f k8s/secret.yaml
   ```
2. Deploy the stateful databases (Postgres & Redis):
   ```bash
   kubectl apply -f k8s/postgres.yaml
   kubectl apply -f k8s/redis.yaml
   ```
3. Deploy the application services:
   ```bash
   kubectl apply -f k8s/api-deployment.yaml
   kubectl apply -f k8s/worker-deployment.yaml
   ```
4. Configure Ingress routing:
   ```bash
   kubectl apply -f k8s/ingress.yaml
   ```

---

## 🧪 Testing

To run the automated integration tests:
```bash
npm install
npm test
```
*Note: Ensure your local `.env` is configured to point to a running test database.*

---
*Architected and built to demonstrate mastery in backend engineering, distributed systems, and DevOps principles.*

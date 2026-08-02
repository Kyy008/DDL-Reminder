# Deploy DDL Reminder

This project can be deployed to a Linux server with GitHub Actions over SSH. The server builds and runs the app with Docker Compose.

## 1. Prepare the server

SSH into the server:

```bash
ssh root@39.102.59.66
```

Install Docker and the Compose plugin if they are not installed yet. On Ubuntu or Debian, this is usually enough:

```bash
apt update
apt install -y docker.io docker-compose-plugin
systemctl enable --now docker
```

Then create the deploy directory:

```bash
mkdir -p /opt/ddl-reminder/releases
```

Make sure the server firewall and cloud security group allow inbound `22` for SSH and `3000` for the app, unless you put the app behind Nginx on `80/443`.

Create `/opt/ddl-reminder/.env` on the server:

```bash
nano /opt/ddl-reminder/.env
```

Use this shape, replacing every secret value:

```env
POSTGRES_DB=ddl_reminder
POSTGRES_USER=postgres
POSTGRES_PASSWORD=replace-with-a-strong-password

DATABASE_URL=postgresql://postgres:replace-with-a-strong-password@postgres:5432/ddl_reminder
SESSION_SECRET=replace-with-a-long-random-string
APP_URL=http://39.102.59.66:3000
APP_PORT=3000

SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
MAIL_FROM=DDL Reminder <your-smtp-user@example.com>
TZ=Asia/Shanghai
```

`POSTGRES_PASSWORD` and the password inside `DATABASE_URL` must match.

## 2. Create an SSH deploy key

On your local machine:

```bash
ssh-keygen -t ed25519 -C "ddl-reminder-github-actions" -f ~/.ssh/ddl_reminder_deploy
```

Copy the public key to the server:

```bash
ssh-copy-id -i ~/.ssh/ddl_reminder_deploy.pub root@39.102.59.66
```

Test it:

```bash
ssh -i ~/.ssh/ddl_reminder_deploy root@39.102.59.66
```

## 3. Add GitHub repository secrets

In GitHub, open the repository, then go to `Settings -> Secrets and variables -> Actions -> New repository secret`.

Add these secrets:

```text
SERVER_HOST=39.102.59.66
SERVER_USER=root
SERVER_PORT=22
DEPLOY_PATH=/opt/ddl-reminder
SSH_PRIVATE_KEY=<contents of ~/.ssh/ddl_reminder_deploy>
```

For `SSH_PRIVATE_KEY`, paste the full private key file, including the begin and end lines.

## 4. Deploy

Push to `main`. After the `CI` workflow succeeds, the `Deploy` workflow will publish the same commit. You can also run the `Deploy` workflow manually from GitHub Actions.

After the first run, check the server:

```bash
cd /opt/ddl-reminder/current
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f app
```

The app should be available at:

```text
http://39.102.59.66:3000
```

If you later add a domain name, update `APP_URL` in `/opt/ddl-reminder/.env` and point Nginx or another reverse proxy to `127.0.0.1:3000`.

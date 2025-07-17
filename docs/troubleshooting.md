# Troubleshooting Guide

## 🚀 Quick Fixes

### First-Time Setup Issues

**Recommended**: Use the interactive setup script for guided configuration:

```bash
yarn setup
```

This script will automatically:

- Check Docker status
- Start database services
- Create your first manager account
- Configure webhooks (optional)

If you encounter issues during setup, try:

```bash
yarn docker:reset    # Complete reset
yarn setup           # Run setup again
```

## 🔧 Common Issues

### Docker Issues

#### Docker Desktop Not Running

```bash
# If Docker Desktop isn't running:
# 1. Start Docker Desktop from Applications
# 2. Wait for it to fully load (whale icon in menu bar)
# 3. Try yarn start again
```

#### Container Startup Failures

```bash
# If containers fail to start:
yarn docker:reset               # Reset and restart containers

# If ports are in use:
yarn docker:down                # Stop existing containers
docker compose ps               # Check no containers running

# Manual Docker management:
yarn docker:up                  # Start containers manually
yarn start:frontend-only        # Then start Angular
```

#### Volume/Permission Issues

```bash
# Reset volumes and rebuild
docker compose down -v
docker compose build --no-cache
docker compose up -d

# Check container logs
docker compose logs postgres
docker compose logs postgrest
```

### Backend Connection Issues

#### PostgreSQL Connection Problems

```bash
# Verify PostgreSQL is running
docker compose ps

# Check PostgreSQL logs
docker compose logs postgres

# Test direct connection
docker compose exec postgres psql -U postgres -d changelog -c "SELECT version();"

# Check if port is accessible
telnet localhost 5432
```

#### PostgREST API Issues

```bash
# Check PostgREST health
curl http://localhost:3000/

# Verify PostgREST logs
docker compose logs postgrest

# Test specific endpoint
curl http://localhost:3000/products

# Check authentication
curl -H "Authorization: Bearer your-jwt-token" http://localhost:3000/managers
```

#### Express Server Issues

```bash
# Verify Express server proxy
curl http://localhost:4204/api/health

# Check environment configuration
cat src/environments/environment.development.ts

# Test specific API endpoints
curl http://localhost:4204/api/products
curl http://localhost:4204/api/auth/status
```

### Frontend Issues

#### Angular Build Problems

```bash
# Clear Angular cache
npx ng cache clean

# Reinstall dependencies
rm -rf node_modules yarn.lock
yarn install

# Check for TypeScript errors
yarn build --verbose
```

#### Hot Reload Not Working

```bash
# Restart development server
yarn start:frontend-only

# Check if files are being watched
# Ensure no symlinks in project path
# Check file permissions
```

#### Styling Issues

```bash
# Rebuild Tailwind CSS
yarn build:css

# Check for PrimeNG theme conflicts
# Verify Tailwind configuration
# Clear browser cache
```

### Database Issues

#### Database Reset

```bash
# Complete database reset (removes all data)
docker compose down -v
docker compose up -d

# Wait for initialization to complete
docker compose logs -f postgres
```

#### Migration Issues

```bash
# Check initialization logs
docker compose logs postgres | grep -E "(ERROR|NOTICE)"

# Manually run specific migration
docker compose exec postgres psql -U postgres -d changelog -f /docker-entrypoint-initdb.d/01-roles.sql

# Check table existence
docker compose exec postgres psql -U postgres -d changelog -c "\dt"
```

#### RLS Policy Issues

```bash
# Check RLS policies
docker compose exec postgres psql -U postgres -d changelog -c "\d+ managers"

# Test RLS with specific user
docker compose exec postgres psql -U postgres -d changelog -c "SET role authenticated; SELECT auth.is_manager();"

# Debug auth functions
docker compose exec postgres psql -U postgres -d changelog -c "SELECT auth.email(), auth.manager_id();"
```

### Authentication Issues

#### Auth0 Configuration

- Check browser console for authentication errors
- Verify Auth0 configuration in Express server
- Ensure CORS settings allow frontend origin
- Check cookie settings for authentication

```bash
# Test Auth0 endpoints
curl http://localhost:4204/api/auth/login
curl http://localhost:4204/api/auth/status

# Check environment variables
echo $AUTH0_DOMAIN
echo $AUTH0_CLIENT_ID
```

#### Manager Access Issues

```bash
# Check if user is in managers table
docker compose exec postgres psql -U postgres -d changelog -c "SELECT * FROM managers WHERE email = 'your-email@example.com';"

# Add user as manager
docker compose exec postgres psql -U postgres -d changelog -c "SELECT * FROM setup_initial_manager('your-email@example.com');"

# Check manager functions
docker compose exec postgres psql -U postgres -d changelog -c "SELECT * FROM add_manager('new-manager@example.com');"
```

### Webhook Issues

#### Slack Webhook Not Working

```bash
# Verify webhook URL is configured
docker compose exec postgres psql -U postgres -d changelog -c "SELECT * FROM system_settings WHERE key = 'webhook_url';"

# Check Express server accessibility from Docker
docker compose exec postgres curl http://host.docker.internal:4204/api/webhooks/slack

# Test webhook endpoint manually
curl -X POST -H "Content-Type: application/json" -d '{"test": true}' http://localhost:4204/api/webhooks/slack

# Check webhook trigger
docker compose exec postgres psql -U postgres -d changelog -c "UPDATE changelog_entries SET status = 'published' WHERE id = 'some-id';"
```

#### Database Trigger Issues

```bash
# Check if trigger exists
docker compose exec postgres psql -U postgres -d changelog -c "SELECT * FROM information_schema.triggers WHERE trigger_name = 'changelog_published_webhook';"

# Check trigger function
docker compose exec postgres psql -U postgres -d changelog -c "\df handle_changelog_webhook"

# Test HTTP extension
docker compose exec postgres psql -U postgres -d changelog -c "SELECT http_get('http://httpbin.org/get');"
```

### Build Issues

#### TypeScript Compilation Errors

```bash
# Check TypeScript configuration
npx tsc --noEmit

# Verify all imports
yarn build --verbose 2>&1 | grep -i error

# Check for missing dependencies
yarn install --check-files
```

#### Bundle Size Issues

```bash
# Analyze bundle size
yarn build --analyze

# Check for duplicate dependencies
yarn dedupe

# Optimize imports
# Use lazy loading for heavy modules
```

### Performance Issues

#### Slow Database Queries

```bash
# Enable query logging in PostgreSQL
docker compose exec postgres psql -U postgres -d changelog -c "ALTER SYSTEM SET log_statement = 'all';"
docker compose restart postgres

# Check slow queries
docker compose logs postgres | grep -E "(duration|slow)"

# Analyze query plans
docker compose exec postgres psql -U postgres -d changelog -c "EXPLAIN ANALYZE SELECT * FROM changelog_entries;"
```

#### Memory Issues

```bash
# Check container memory usage
docker stats

# Monitor Node.js memory
pm2 monit

# Check for memory leaks in Angular
# Use Chrome DevTools Memory tab
```

## 📝 Development Tips

### Debugging Strategies

1. **Start Simple**: Test each component individually
2. **Check Logs**: Always check container logs first
3. **Verify Connections**: Test database and API connections
4. **Use Browser DevTools**: Network tab for API issues
5. **Database Direct Access**: Test queries directly in PostgreSQL

### Useful Commands

```bash
# Complete environment reset
yarn stop && yarn docker:reset && yarn start

# Check all service health
curl http://localhost:4204/api/health
curl http://localhost:3000/
docker compose exec postgres pg_isready

# Database shell access
docker compose exec postgres psql -U postgres -d changelog

# View all logs
docker compose logs -f
```

### Log Locations

- **Angular Development**: Browser console
- **Express Server**: Terminal output when running `yarn start`
- **PostgreSQL**: `docker compose logs postgres`
- **PostgREST**: `docker compose logs postgrest`
- **Production PM2**: `pm2 logs v1-changelog`

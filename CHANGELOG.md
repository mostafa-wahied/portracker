# Changelog

All notable changes to portracker will be documented in this file.

## [1.2.0] - 2025-11-20

### Security

- **Authentication**: Optional authentication to secure dashboard access using `ENABLE_AUTH=true`
  - **[sub]** Disabled by default for backward compatibility
  - **[sub]** Recovery mode accessible via `RECOVERY_MODE=true` if you lose your password
  - **[sub]** When recovery mode is enabled, a time-limited recovery code (valid 15 minutes) appears in the logs to use on the login page with any username

### Dashboard

- **Auto-Refresh**: Added a toggle to auto-refresh ports and services every 30 seconds
- **Random Port Generator**: Generate an unused port with a single click

## [1.1.1] - 2025-01-17

### Server Integrations

- **TrueNAS Enhanced Features**: Add your TrueNAS API key directly from the UI to unlock VM and LXC container monitoring with step-by-step setup instructions

### Fixes

- **TrueNAS API Key Revocation**: Fixed automatic key revocation issue by prioritizing secure WebSocket connections
- **Virtual Machines & Containers**: VMs and LXC containers now display correctly with icons and badges to distinguish between them
- **Debug Logging**: DEBUG environment variable now properly enables debug output

## [1.1.0] - 2025-08-23

### Dashboard

- **System Port Name Fix**: Fixed the issue where system ports were incorrectly displayed as "unknown".
- **Consistent Status Indicators**: Improved status indicators for system ports to ensure consistency.

## [1.0.8] - 2025-08-20

### Dashboard

- **Batch rename migration fix**: Fix migration issue affecting batch rename operations so renamed services persist correctly.
- **Misc.**: minor migration-related fix for batch rename flow.

## [1.0.7] - 2025-08-19

### Dashboard

- **Service renaming**: Allow renaming services from the UI.
- **Batch actions**: Add selection and batch operations for services and ports (ignore, add note, etc.).
- **Internal / Port display fixes**: Fix display issues so internal and published ports are shown correctly; fix select-box overlap.

### Backend

- **Port protocol reporting**: Ensure ports include protocol information so reported mappings are accurate.

## [1.0.6] - 2025-08-15

### Dashboard

- **Container Details Drawer**: New slide-out panel to show detailed information for Docker containers including stats, labels, mounts, and environment variables
- **Internal Port Display**: UI now correctly shows and differentiates internal-only ports from published ports with health status monitoring
- **Global Search**: Search bar now includes an option to search across all servers simultaneously
- **What's New**: Automatic notification system to stay updated with new features when releasing new versions

### Data

- **Collector Caching**: Added caching mechanism to all data collectors to reduce duplicate requests and improve data refresh speed

## [1.0.5] - 2025-08-09

### Server Integrations

- **Dockerode Integration**: Switched to use the dockerode library for more reliable Docker API interactions instead of shell commands
- **Centralized Logging**: All collectors now use a single Logger class for consistent and structured logging throughout the application

## [1.0.4] - 2025-08-09

### Dashboard

- **Enhanced Service Detection**: Improved identification and categorization of running services with Single Page Application (SPA) detection support
- **Port Status Indicators**: Added clear visual distinction between different types of ports (published vs internal) with detailed status information

### Server Integrations

- **Removed network_mode: host Requirement**: Eliminated the need for Docker host networking mode by implementing direct /proc filesystem parsing for better security
- **Advanced Port Detection**: Enhanced system for more accurate container and system port identification using multiple detection methods
- **Improved Container Introspection**: Better error handling and fallback strategies across different platforms for reliable port collection

## [1.0.3] - 2025-08-07

### Data

- **Simplified Docker Dependencies**: Streamlined system requirements - no longer requires mounting additional system sockets for container information and support for docker proxy.
- **Enhanced Data Accuracy**: Improved container information display with more accurate timestamps and metadata parsing

## [1.0.2] - 2025-07-11

### Security

- **Security Hardening**: Key security aspects addressed
- **Data Collection**: Improved data collection accuracy

## [1.0.1] - 2025-07-10

### Initial Improvements

- Various fixes and improvements after initial release

## [1.0.0] - 2025-07-07

### Dashboard

- **Multi-platform Port Tracking**: Initial release of portracker with support for monitoring ports across multiple servers
- **Docker Integration**: Native Docker container port monitoring
- **Web Interface**: Clean, responsive web interface for port management
- **Server Management**: Support for multiple server configurations

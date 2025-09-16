# Public Meetings Architecture

## 📊 Overview

The public meetings feature allows unauthenticated users to access specific meeting pages, enabling broader participation while maintaining security through optional passcode protection and server-side API authentication.

## 🏗 Architecture Components

### Public Meeting Routes

The system exposes public endpoints that bypass user authentication:

- **Public API Endpoint**: `/public/api/meetings/:id` - Returns meeting and project data
- **Frontend Route**: `/meetings/:id` - Displays the meeting page without authentication
- **Access Control**: Meeting visibility levels and optional passcode protection

### Controller Architecture

**Location**: `apps/lfx-one/src/server/controllers/public-meeting.controller.ts`

The public meeting controller handles:

1. **Request Validation**: Validates meeting IDs and parameters
2. **M2M Token Generation**: Creates server-side authentication tokens
3. **Data Fetching**: Retrieves meeting and project information
4. **Access Control**: Enforces visibility rules and passcode requirements
5. **Response Formatting**: Returns appropriate data based on meeting visibility

### Meeting Visibility Levels

The system supports different visibility configurations:

- **PUBLIC**: Fully accessible without authentication or passcode
- **PRIVATE**: Requires passcode for access, limited data exposure
- **RESTRICTED**: Not accessible through public endpoints (future)

## 🔐 Security Architecture

### M2M Authentication for Backend Calls

Public endpoints use machine-to-machine tokens for backend API authentication:

1. **Token Generation**: Server generates M2M token for each request
2. **Token Injection**: Bearer token added to internal API calls
3. **API Authentication**: Backend services receive authenticated requests
4. **User Transparency**: End users don't need authentication

**Implementation**: `apps/lfx-one/src/server/utils/m2m-token.util.ts`

### Passcode Protection

For private meetings:

- **Passcode Validation**: Compares provided passcode with stored Zoom configuration
- **Limited Data Exposure**: Returns only essential project information when passcode-protected
- **Error Handling**: Returns authentication errors for invalid passcodes

## 📁 Frontend Implementation

### Public Meeting Component

**Location**: `apps/lfx-one/src/app/modules/meetings/meeting.component.ts`

The Angular component handles:

1. **Meeting Display**: Shows meeting details and join options
2. **Authentication Status**: Works for both authenticated and unauthenticated users
3. **Passcode Handling**: Manages passcode input for private meetings
4. **Registration Flow**: Handles meeting registration when required
5. **Error States**: Displays appropriate messages for access restrictions

### Route Configuration

The meeting routes are configured to allow public access:

```typescript
// apps/lfx-one/src/app/app.routes.ts
{
  path: 'meetings/:id',
  loadComponent: () => import('./modules/meetings/meeting.component').then(m => m.MeetingComponent),
}
```

## 🔄 Request Flow

```text
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Browser    │────▶│  Public Meeting  │────▶│   M2M Token     │
│              │     │   Controller     │     │   Generator     │
└──────────────┘     └──────────────────┘     └─────────────────┘
                              │                         │
                              │                         │
                              ▼                         ▼
                     ┌──────────────────┐     ┌─────────────────┐
                     │ Meeting Service  │◀────│  Auth Provider  │
                     │   (with M2M)     │     │ (Auth0/Authelia)│
                     └──────────────────┘     └─────────────────┘
                              │
                              ▼
                     ┌──────────────────┐
                     │   Backend API    │
                     │   (LFX Service)  │
                     └──────────────────┘
```

## 🔧 Configuration

### Environment Variables

The public meetings feature requires:

- **M2M Authentication**: M2M_AUTH_CLIENT_ID, M2M_AUTH_CLIENT_SECRET
- **API Configuration**: LFX_V2_SERVICE endpoint
- **Auth Provider**: M2M_AUTH_ISSUER_BASE_URL, M2M_AUTH_AUDIENCE

### Middleware Integration

The protected routes middleware allows public meeting routes to bypass authentication:

**Location**: `apps/lfx-one/src/server/middleware/protected-routes.middleware.ts`

- Uses an explicit allowlist for prefixes: `/public/api/meetings` (API) and SPA route `/meetings/:id`
- Bypasses only user–session auth for those allowlisted routes; server-to-server (M2M) calls still require auth
- Applies standard authentication to all other routes (avoid loose regexes like `/meeting.*`)
- Add unit tests verifying that only those exact prefixes bypass auth and that all similar prefixes remain protected

## 📊 Data Flow

### Public Meeting Request

1. **User Access**: User navigates to `/meetings/:id`
2. **Route Analysis**: Protected routes middleware allows access
3. **Component Load**: Angular loads meeting component
4. **API Call**: Component requests meeting data from `/public/api/meetings/:id`
5. **M2M Auth**: Server generates M2M token for backend calls
6. **Data Fetch**: Controller retrieves meeting and project data
7. **Access Check**: Validates meeting visibility and passcode if required
8. **Response**: Returns appropriate data based on access level

### Response Structure

The API returns different data based on meeting visibility:

**Public Meetings**:

- Full meeting details
- Complete project information
- Registration options
- Join meeting capabilities

**Private Meetings (with passcode)**:

- Full meeting details after validation
- Limited project information (name, slug, logo)
- Registration restricted based on configuration

## 🎯 Use Cases

### Supported Scenarios

1. **Open Community Meetings**: Public meetings accessible to everyone
2. **Protected Meetings**: Private meetings with passcode sharing
3. **Meeting Discovery**: Users can access meeting details without account
4. **Quick Join**: Direct meeting access without authentication overhead
5. **SEO Benefits**: Public meeting pages indexed by search engines

### Limitations

- **No User Tracking**: Cannot track individual attendees without authentication
- **Limited Personalization**: No user-specific features for public access
- **Registration Constraints**: Some registration types may require authentication

## 🔒 Security Considerations

1. **Data Exposure**: Only non-sensitive meeting data exposed publicly
2. **Rate Limiting**: Public endpoints protected against abuse
3. **Input Validation**: Strict validation of meeting IDs and parameters
4. **Passcode Security**: Passcodes validated server-side only
5. **M2M Token Scope**: Limited permissions for public endpoint tokens

## 📈 Future Enhancements

- **Analytics Integration**: Track public meeting access patterns
- **Caching Layer**: Improve performance for frequently accessed meetings
- **Registration Enhancement**: Support more registration types for public users
- **Meeting Previews**: Limited time-based access for private meetings
- **Social Sharing**: Enhanced metadata for social media sharing

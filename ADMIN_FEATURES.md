# Admin Platform Features Documentation

## Overview
This document describes all the advanced features implemented in the Learning with AI admin platform.

## ✅ Implemented Features

### 1. Quick Wins (Already Deployed)
- ✅ **Pagination Controls**: 20 items per page for sessions and students tables
- ✅ **Advanced Filters**: Date range, subject, search by name/room code
- ✅ **CSV Export**: One-click export for filtered sessions and students data
- ✅ **Real-time Active Rooms Counter**: Auto-refreshes every 30 seconds
- ✅ **Analytics Dashboard**: Visual charts with Chart.js
  - Performance by grade level (bar chart)
  - Performance by subject (doughnut chart)  
  - Session activity timeline (line chart)
- ✅ **Bulk Delete Sessions**: Remove sessions older than 30 days
- ✅ **Search & Filter UI**: Clean filter panels with apply/clear buttons
- ✅ **Audit Log Tab**: Placeholder structure ready

### 2. Backend API Endpoints (Newly Added)

#### Question Bank Management
```
GET    /admin/questions              - List questions (with filters)
POST   /admin/questions              - Create new question
PUT    /admin/questions/:id          - Update question
DELETE /admin/questions/:id          - Soft delete question
```

**Example Request (Create Question):**
```json
POST /admin/questions
Authorization: Bearer YOUR_ADMIN_TOKEN
Content-Type: application/json

{
  "curriculum": "international",
  "language": "english",
  "subject": "math",
  "grade_level": 6,
  "difficulty_mode": "standard",
  "prompt": "What is 12 + 15?",
  "choices": [
    {"id": "A", "text": "25"},
    {"id": "B", "text": "27"},
    {"id": "C", "text": "29"},
    {"id": "D", "text": "31"}
  ],
  "correct_choice": "B",
  "short_explanation": "Twelve plus fifteen equals twenty-seven.",
  "elaboration": "You can add 12 + 15 by combining 10 + 10 = 20, then 2 + 5 = 7, giving us 27."
}
```

#### Student Management
```
PUT    /admin/students/:id           - Update student name
POST   /admin/students/:id/block     - Block student
DELETE /admin/students/:id/block     - Unblock student
```

**Example Request (Block Student):**
```json
POST /admin/students/STUDENT_ID/block
Authorization: Bearer YOUR_ADMIN_TOKEN

{
  "reason": "Inappropriate behavior",
  "expires_at": "2026-07-18T12:00:00Z"
}
```

#### Student Groups
```
GET    /admin/groups                 - List all groups
POST   /admin/groups                 - Create group
POST   /admin/groups/:id/members     - Add student to group
```

**Example Request (Create Group):**
```json
POST /admin/groups
Authorization: Bearer YOUR_ADMIN_TOKEN

{
  "name": "Grade 6 Math Club",
  "description": "Advanced math students"
}
```

#### Active Session Control
```
GET    /admin/active-sessions                     - List active rooms
POST   /admin/active-sessions/:roomCode/close     - Force close room
POST   /admin/active-sessions/:roomCode/kick/:playerId - Kick player
```

**Example Request (Close Room):**
```bash
POST /admin/active-sessions/ABC123/close
Authorization: Bearer YOUR_ADMIN_TOKEN
```

#### Audit Logs
```
GET    /admin/audit                  - View audit log (last 100 actions)
```

The audit logging system automatically tracks:
- Admin username
- Action performed
- Resource type and ID
- Request details (IP address, user agent)
- Timestamp

### 3. Database Schema (New Tables)

#### `admin_users`
Multi-admin support with role-based permissions
```sql
- id (TEXT PRIMARY KEY)
- username (TEXT UNIQUE)
- password_hash (TEXT)
- role (TEXT) - 'admin', 'viewer', 'teacher', etc.
- email (TEXT)
- is_active (BOOLEAN)
- created_at, updated_at, last_login_at (TIMESTAMPTZ)
```

#### `audit_logs`
Complete audit trail of admin actions
```sql
- id (TEXT PRIMARY KEY)
- admin_id (TEXT)
- admin_username (TEXT)
- action (TEXT)
- resource_type (TEXT)
- resource_id (TEXT)
- details (JSONB)
- ip_address (TEXT)
- user_agent (TEXT)
- created_at (TIMESTAMPTZ)
```

#### `question_bank`
Reusable question library
```sql
- id (TEXT PRIMARY KEY)
- curriculum, language, subject, grade_level
- difficulty_mode (TEXT)
- prompt, choices (JSONB), correct_choice
- short_explanation, elaboration (TEXT)
- is_active (BOOLEAN)
- usage_count (INTEGER)
- created_by (TEXT)
- created_at, updated_at (TIMESTAMPTZ)
```

#### `student_blocks`
Student blocking/banning system
```sql
- id (TEXT PRIMARY KEY)
- student_id (TEXT REFERENCES students)
- reason (TEXT)
- blocked_by (TEXT)
- blocked_at, expires_at (TIMESTAMPTZ)
- is_active (BOOLEAN)
```

#### `student_groups` & `student_group_members`
Group management for organizing students
```sql
-- student_groups
- id (TEXT PRIMARY KEY)
- name, description (TEXT)
- created_by (TEXT)
- created_at, updated_at (TIMESTAMPTZ)

-- student_group_members
- group_id (TEXT REFERENCES student_groups)
- student_id (TEXT REFERENCES students)
- added_by (TEXT)
- added_at (TIMESTAMPTZ)
```

## 🔄 Next Steps for Full Implementation

### Frontend UI Updates Needed

The backend APIs are complete. To fully utilize these features, the admin UI (`apps/admin-web/index.html`) should be updated with:

1. **Question Bank Tab**
   - List all questions with filters
   - Create/edit question form
   - Delete/deactivate questions
   - View question usage statistics

2. **Enhanced Students Tab**
   - Edit student name inline
   - Block/unblock student buttons
   - View block history
   - Assign students to groups

3. **Groups Tab**
   - Create new groups
   - View group members
   - Add/remove students from groups
   - Group-based analytics

4. **Active Sessions Tab**
   - Real-time list of active rooms
   - Close room button
   - Kick player functionality
   - View current room state

5. **Enhanced Audit Tab**
   - Replace placeholder with real audit log data
   - Filter by action type, date range, admin user
   - Export audit logs
   - Detailed view of each action

## 🚀 Deployment Instructions

### 1. Database Migration
When deploying to production, the new tables will be created automatically on first run. The gateway checks and creates missing tables on startup.

### 2. Environment Variables
No new environment variables required. Existing `ADMIN_TOKEN` and `DATABASE_URL` are sufficient.

### 3. Railway Deployment
```bash
# Pull latest code
git pull origin main

# Railway will automatically restart gateway with new code
# New database tables will be created on first request
```

### 4. Verify Deployment
```bash
# Check health endpoint
curl https://your-gateway.railway.app/health

# Test new endpoint (requires ADMIN_TOKEN)
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  https://your-gateway.railway.app/admin/active-sessions
```

## 📊 Usage Examples

### Managing Questions

**Scenario**: Add custom questions for Grade 8 Physics

```bash
# Create a new question
curl -X POST https://gateway.railway.app/admin/questions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "curriculum": "international",
    "language": "english",
    "subject": "physics",
    "grade_level": 8,
    "difficulty_mode": "standard",
    "prompt": "What is the SI unit of force?",
    "choices": [
      {"id": "A", "text": "Newton"},
      {"id": "B", "text": "Joule"},
      {"id": "C", "text": "Watt"},
      {"id": "D", "text": "Pascal"}
    ],
    "correct_choice": "A",
    "short_explanation": "Force is measured in Newtons.",
    "elaboration": "The Newton (N) is the SI unit of force, named after Isaac Newton. One Newton equals one kilogram-meter per second squared."
  }'

# List all physics questions
curl "https://gateway.railway.app/admin/questions?subject=physics&gradeLevel=8" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Managing Students

**Scenario**: Block a disruptive student temporarily

```bash
# Block student for 7 days
curl -X POST https://gateway.railway.app/admin/students/STUDENT_ID/block \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Disruptive behavior in quiz sessions",
    "expires_at": "2026-06-25T12:00:00Z"
  }'

# Later: Unblock student
curl -X DELETE https://gateway.railway.app/admin/students/STUDENT_ID/block \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Session Control

**Scenario**: Close an active room that's stuck

```bash
# List active sessions
curl https://gateway.railway.app/admin/active-sessions \
  -H "Authorization: Bearer YOUR_TOKEN"

# Close problematic room
curl -X POST https://gateway.railway.app/admin/active-sessions/ABC123/close \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Creating Student Groups

**Scenario**: Organize students by class

```bash
# Create group
GROUP_RESPONSE=$(curl -X POST https://gateway.railway.app/admin/groups \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Grade 6A - Morning Class",
    "description": "Mrs. Smith morning class students"
  }')

GROUP_ID=$(echo $GROUP_RESPONSE | jq -r '.groupId')

# Add students to group
curl -X POST https://gateway.railway.app/admin/groups/$GROUP_ID/members \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"student_id": "STUDENT_ID_1"}'
```

## 🔐 Security Features

1. **Token-based Authentication**: All admin endpoints require `ADMIN_TOKEN`
2. **Audit Logging**: Every admin action is logged with IP and user agent
3. **Soft Deletes**: Questions are deactivated, not permanently deleted
4. **Input Sanitization**: All student names and inputs are sanitized
5. **SQL Injection Protection**: Parameterized queries throughout

## 📈 Performance Considerations

1. **Indexes**: All frequently queried columns are indexed
2. **Pagination**: Default limit of 100 items per request, max 100
3. **Cascading Deletes**: Database handles cleanup automatically
4. **Connection Pooling**: PostgreSQL connection pool configured

## 🐛 Troubleshooting

### Database tables not created
```bash
# Check gateway logs for errors
# Tables are created on startup via initDatabase()
# Verify DATABASE_URL is correctly set
```

### Audit logs not appearing
```bash
# Ensure database is connected
# Check that logAuditAction() is being called
# Verify audit_logs table exists
```

### Questions not being used
```bash
# Question bank is currently for manual management
# Future: Integration with quiz generation to use custom questions
# Current: AI generates questions OR uses fallback bank
```

## 📝 Future Enhancements

### Planned Features (Not Yet Implemented)
1. **Multi-Admin Authentication System**
   - Login/logout endpoints
   - Password hashing with bcrypt
   - JWT token generation
   - Role-based access control

2. **Email Notifications**
   - System error alerts
   - Weekly reports
   - Quota warnings

3. **Advanced Analytics**
   - Real-time session activity chart with actual data
   - Student performance trends over time
   - Question difficulty analysis

4. **Question Bank Integration**
   - Use custom questions in quizzes
   - Question review/approval workflow
   - Community question sharing

5. **Student Achievements**
   - Badge system
   - Leaderboards
   - Progress certificates

## 📞 Support

For issues or questions about these features:
1. Check the audit logs for detailed error information
2. Review gateway server logs
3. Verify DATABASE_URL and ADMIN_TOKEN environment variables
4. Test endpoints with curl before UI integration

---

**Version**: 1.1.0  
**Last Updated**: June 18, 2026  
**Status**: Backend Complete, Frontend UI Pending
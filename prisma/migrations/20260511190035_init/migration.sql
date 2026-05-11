-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('LEAD', 'ADMIN', 'OWNER', 'HR', 'MANAGER', 'STREAMER');

-- CreateEnum
CREATE TYPE "EnglishLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'FLUENT');

-- CreateEnum
CREATE TYPE "LeadPhase" AS ENUM ('ENTERED', 'TASK_COMPLETED', 'MEET_INVITED', 'MEET_ATTENDED', 'MEET_MISSED', 'STREAMER');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('ACTIVE', 'PAUSED', 'REJECTED', 'GHOSTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('NUMBER', 'TEXT', 'CHOICE', 'MULTI_CHOICE', 'BOOLEAN');

-- CreateEnum
CREATE TYPE "StepType" AS ENUM ('TEXT', 'PHOTO', 'VIDEO_NOTE', 'VOICE', 'BUTTONS', 'DELAY', 'SURVEY');

-- CreateEnum
CREATE TYPE "MediaAssetType" AS ENUM ('VIDEO_NOTE', 'PHOTO', 'VOICE', 'VIDEO', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "IntroCallStatus" AS ENUM ('SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LessonInstanceStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'MISSED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "telegramUserId" BIGINT NOT NULL,
    "telegramUsername" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "role" "Role" NOT NULL DEFAULT 'LEAD',
    "discordUserId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceCode" TEXT,
    "surveyAnswers" JSONB NOT NULL DEFAULT '{}',
    "age" INTEGER,
    "country" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Kyiv',
    "countryNeedsReview" BOOLEAN NOT NULL DEFAULT false,
    "birthPlace" TEXT,
    "englishLevel" "EnglishLevel",
    "tiktokUsername" TEXT,
    "adminNotes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "phase" "LeadPhase" NOT NULL DEFAULT 'ENTERED',
    "status" "LeadStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentLessonNumber" INTEGER NOT NULL DEFAULT 0,
    "promotedToStreamerAt" TIMESTAMP(3),
    "assignedManagerId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "currentScenarioId" TEXT,
    "currentScenarioStepId" TEXT,
    "currentSurveyQuestionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Country" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAliases" TEXT[],
    "isoCode" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "flagEmoji" TEXT,
    "isTopCountry" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Country_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyQuestion" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT,
    "key" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "hint" TEXT,
    "type" "QuestionType" NOT NULL,
    "options" JSONB,
    "validation" JSONB,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL,
    "isCountryQuestion" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SurveyQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scenario" (
    "id" TEXT NOT NULL,
    "sourceCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Step" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" "StepType" NOT NULL,
    "content" JSONB NOT NULL,
    "mediaAssetId" TEXT,
    "nextStepId" TEXT,
    "delayAfterSeconds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "type" "MediaAssetType" NOT NULL,
    "telegramFileId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "uploadedByUserId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntroCall" (
    "id" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "meetUrl" TEXT NOT NULL,
    "description" TEXT,
    "status" "IntroCallStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntroCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetInvite" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "introCallId" TEXT NOT NULL,
    "leadProfileId" TEXT NOT NULL,
    "reminder1DaySentAt" TIMESTAMP(3),
    "reminder15MinSentAt" TIMESTAMP(3),
    "reminder5MinSentAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "attended" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lesson" (
    "id" INTEGER NOT NULL,
    "stage" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "videoUrl" TEXT,
    "textContent" TEXT,
    "materialsJson" JSONB,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "recurringDayOfWeek" INTEGER,
    "recurringTime" TEXT,
    "recurringChannel" TEXT,
    "recurringTeacherId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonInstance" (
    "id" TEXT NOT NULL,
    "lessonId" INTEGER NOT NULL,
    "teacherId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "LessonInstanceStatus" NOT NULL DEFAULT 'SCHEDULED',
    "channelInfo" TEXT,
    "managerNotes" TEXT,
    "reminder24hSentAt" TIMESTAMP(3),
    "reminder1hSentAt" TIMESTAMP(3),
    "reminder15minSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonParticipation" (
    "id" TEXT NOT NULL,
    "lessonInstanceId" TEXT NOT NULL,
    "leadProfileId" TEXT NOT NULL,
    "attended" BOOLEAN,

    CONSTRAINT "LessonParticipation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "diff" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeworkAssignment" (
    "id" TEXT NOT NULL,
    "leadProfileId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ASSIGNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HomeworkAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StreamReview" (
    "id" TEXT NOT NULL,
    "leadProfileId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "streamDate" DATE NOT NULL,
    "metrics" JSONB NOT NULL,
    "comments" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StreamReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Revenue" (
    "id" TEXT NOT NULL,
    "leadProfileId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "weekEnd" DATE NOT NULL,
    "grossIncomeUsd" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Revenue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramUserId_key" ON "User"("telegramUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_discordUserId_key" ON "User"("discordUserId");

-- CreateIndex
CREATE INDEX "User_telegramUsername_idx" ON "User"("telegramUsername");

-- CreateIndex
CREATE UNIQUE INDEX "LeadProfile_userId_key" ON "LeadProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadProfile_tiktokUsername_key" ON "LeadProfile"("tiktokUsername");

-- CreateIndex
CREATE INDEX "LeadProfile_phase_idx" ON "LeadProfile"("phase");

-- CreateIndex
CREATE INDEX "LeadProfile_status_idx" ON "LeadProfile"("status");

-- CreateIndex
CREATE INDEX "LeadProfile_country_idx" ON "LeadProfile"("country");

-- CreateIndex
CREATE INDEX "LeadProfile_assignedManagerId_idx" ON "LeadProfile"("assignedManagerId");

-- CreateIndex
CREATE INDEX "LeadProfile_currentLessonNumber_idx" ON "LeadProfile"("currentLessonNumber");

-- CreateIndex
CREATE INDEX "LeadProfile_sourceCode_idx" ON "LeadProfile"("sourceCode");

-- CreateIndex
CREATE INDEX "LeadProfile_tags_idx" ON "LeadProfile" USING GIN ("tags");

-- CreateIndex
CREATE INDEX "LeadProfile_surveyAnswers_idx" ON "LeadProfile" USING GIN ("surveyAnswers");

-- CreateIndex
CREATE UNIQUE INDEX "Country_name_key" ON "Country"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Country_isoCode_key" ON "Country"("isoCode");

-- CreateIndex
CREATE INDEX "Country_nameAliases_idx" ON "Country" USING GIN ("nameAliases");

-- CreateIndex
CREATE INDEX "SurveyQuestion_scenarioId_order_idx" ON "SurveyQuestion"("scenarioId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyQuestion_scenarioId_key_key" ON "SurveyQuestion"("scenarioId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Scenario_sourceCode_key" ON "Scenario"("sourceCode");

-- CreateIndex
CREATE UNIQUE INDEX "Step_scenarioId_order_key" ON "Step"("scenarioId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "MeetInvite_token_key" ON "MeetInvite"("token");

-- CreateIndex
CREATE UNIQUE INDEX "LessonParticipation_lessonInstanceId_leadProfileId_key" ON "LessonParticipation"("lessonInstanceId", "leadProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_key_key" ON "FeatureFlag"("key");

-- AddForeignKey
ALTER TABLE "LeadProfile" ADD CONSTRAINT "LeadProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadProfile" ADD CONSTRAINT "LeadProfile_assignedManagerId_fkey" FOREIGN KEY ("assignedManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyQuestion" ADD CONSTRAINT "SurveyQuestion_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Step" ADD CONSTRAINT "Step_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Step" ADD CONSTRAINT "Step_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetInvite" ADD CONSTRAINT "MeetInvite_introCallId_fkey" FOREIGN KEY ("introCallId") REFERENCES "IntroCall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetInvite" ADD CONSTRAINT "MeetInvite_leadProfileId_fkey" FOREIGN KEY ("leadProfileId") REFERENCES "LeadProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonInstance" ADD CONSTRAINT "LessonInstance_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonInstance" ADD CONSTRAINT "LessonInstance_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonParticipation" ADD CONSTRAINT "LessonParticipation_lessonInstanceId_fkey" FOREIGN KEY ("lessonInstanceId") REFERENCES "LessonInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonParticipation" ADD CONSTRAINT "LessonParticipation_leadProfileId_fkey" FOREIGN KEY ("leadProfileId") REFERENCES "LeadProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

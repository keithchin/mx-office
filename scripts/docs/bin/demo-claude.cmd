@echo off
rem The docs screenshots' stand-in agent for their test office: never calls a model (scripts/docs/agent.mjs).
node "%~dp0..\agent.mjs" %*

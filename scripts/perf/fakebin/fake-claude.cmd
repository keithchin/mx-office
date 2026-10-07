@echo off
rem A stand-in agent for test offices: never calls a model (scripts/perf/fakebin/fake-agent.mjs).
node "%~dp0fake-agent.mjs" %*

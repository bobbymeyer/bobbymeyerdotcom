---
layout: post
title:  "Shortcut for Dictating to an Obsidian Note"
date:   2022-12-12 10:31:00 -0800
emoji: 🛒
summary: Quickly add notes to Obsidian on the go
tags:
- ios
- macos
- shortcuts
- obsidian
- automation
---

**[Add to Voice Notes](https://www.icloud.com/shortcuts/e771079b40684ae9a8c379dd0fb83ab4)**

This is a MacOS/iOS shortcut that allows users to quickly dictate notes that are transcribed and added to Obsidian, a note-taking app. The shortcut includes the following steps:

1. Dictate a text note and transcribe the user's voice.
1. Get the current location to provide context for the note.
1. Use the current time, location, and dictated text to create a concatenated text string.
1. Use Obsidian's URI features to add the note programmatically, appending it to a "Voice Notes" note if one already exists or creating a new "Voice Notes" note if one does not already exist.
```
obsidian://new?vault=YOURVAULTNAME&file=Voice Notes&content=Text&append
```
1. Open the URL to send the note to Obsidian.
1. Add the shortcut as a widget on the user's phone for easy access.


![](/assets/img/screenshots/voice-to-obsidian.png)

Add the shortcut as a widget on your phone to be able to dictate to Obsidian in one click.
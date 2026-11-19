# Keep rules for the release build's code shrinker (R8).
# WorkManager's database is created by name at startup; without these the
# shrinker renames it and the app crashes as soon as it opens.
-keep class * extends androidx.room.RoomDatabase { *; }
-keep class androidx.work.impl.WorkDatabase_Impl { *; }
-keep class androidx.work.** { *; }
# This app's own Android code (plugin and background worker).
-keep class com.straycat.rssreader.** { *; }

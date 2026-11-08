Pod::Spec.new do |s|
  s.name           = 'AudioSession'
  s.version        = '1.0.0'
  s.summary        = 'Plays WebView audio with the silent switch on'
  s.description    = 'Sets the iOS audio session category to playback (Scrimba Companion local module)'
  s.license        = 'MIT'
  s.author         = 'Scrimba Companion contributors'
  s.homepage       = 'https://github.com/Leisurp/Scrimba-Companion'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end

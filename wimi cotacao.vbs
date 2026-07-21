Option Explicit

Dim shell, fileSystem, projectRoot, logDirectory, logPath
Dim batchPath, command, forwardedArguments, waitForExit, exitCode, index, argument, nodeCheck

Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

projectRoot = fileSystem.GetParentFolderName(WScript.ScriptFullName)
logDirectory = fileSystem.BuildPath(projectRoot, "logs")
logPath = fileSystem.BuildPath(logDirectory, "startup.log")
batchPath = fileSystem.BuildPath(projectRoot, "cotacao.bat")

If Not fileSystem.FolderExists(logDirectory) Then
    fileSystem.CreateFolder(logDirectory)
End If

nodeCheck = shell.Run("cmd.exe /d /c where node >nul 2>&1", 0, True)
If nodeCheck <> 0 Then
    MsgBox "O Node.js LTS nao foi encontrado neste computador." & vbCrLf & _
        "Instale o Node.js e abra novamente o Wimifarma Cotacao.", _
        vbCritical, "Wimifarma Cotacao"
    WScript.Quit 1
End If

forwardedArguments = ""
waitForExit = False
For index = 0 To WScript.Arguments.Count - 1
    argument = CStr(WScript.Arguments(index))
    If LCase(argument) = "--launcher-wait" Then
        waitForExit = True
    Else
        forwardedArguments = forwardedArguments & " " & Chr(34) & Replace(argument, Chr(34), Chr(34) & Chr(34)) & Chr(34)
    End If
Next

command = "cmd.exe /d /s /c " & Chr(34) & Chr(34) & batchPath & Chr(34) & _
    forwardedArguments & " >> " & Chr(34) & logPath & Chr(34) & " 2>&1" & Chr(34)

exitCode = shell.Run(command, 0, waitForExit)
If waitForExit Then WScript.Quit exitCode

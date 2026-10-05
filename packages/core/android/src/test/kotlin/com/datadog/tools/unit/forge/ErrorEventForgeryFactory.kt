/*
 * Unless explicitly stated otherwise all files in this repository are licensed under the Apache License Version 2.0.
 * This product includes software developed at Datadog (https://www.datadoghq.com/).
 * Copyright 2016-Present Datadog, Inc.
 */

package com.datadog.tools.unit.forge

import com.datadog.android.rum.model.ErrorEvent
import fr.xgouchet.elmyr.Forge
import fr.xgouchet.elmyr.ForgeryFactory
import fr.xgouchet.elmyr.jvm.ext.aTimestamp
import java.util.UUID

internal class ErrorEventForgeryFactory :
    ForgeryFactory<ErrorEvent> {
    override fun getForgery(forge: Forge): ErrorEvent {
        return ErrorEvent(
            date = forge.aTimestamp(),
            error = ErrorEvent.Error(
                id = forge.aNullable { getForgery<UUID>().toString() },
                message = forge.anAlphabeticalString(),
                source = forge.aValueFrom(ErrorEvent.ErrorSource::class.java),
                stack = forge.aNullable { anAlphabeticalString() },
                isCrash = forge.aNullable { aBool() },
                type = forge.aNullable { anAlphabeticalString() }
            ),
            view = ErrorEvent.ErrorEventView(
                id = forge.getForgery<UUID>().toString(),
                url = forge.aStringMatching("https://[a-z]+.[a-z]{3}/[a-z0-9_/]+"),
                name = forge.aNullable { anAlphabeticalString() }
            ),
            application = ErrorEvent.Application(forge.getForgery<UUID>().toString()),
            service = forge.aNullable { anAlphabeticalString() },
            session = ErrorEvent.ErrorEventSession(
                id = forge.getForgery<UUID>().toString(),
                type = ErrorEvent.ErrorEventSessionType.USER,
                hasReplay = forge.aNullable { aBool() }
            ),
            source = forge.aNullable { aValueFrom(ErrorEvent.ErrorEventSource::class.java) },
            context = ErrorEvent.Context(
                additionalProperties = mutableMapOf()
            ),
            dd = ErrorEvent.Dd(
                session = forge.aNullable { ErrorEvent.DdSession(getForgery()) },
                browserSdkVersion = forge.aNullable { aStringMatching("\\d+\\.\\d+\\.\\d+") }
            )
        )
    }
}
